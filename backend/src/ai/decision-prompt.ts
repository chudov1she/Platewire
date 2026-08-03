import type { After5Analysis, MatchupInputs, ValueBet } from '../formula/formula.types.js';
import type { ReadinessResult } from '../formula/signal-readiness.service.js';

export const DECISION_SYSTEM_PROMPT = `Ты — старший аналитик ставочного отдела (Analytics Desk) на бейсбол MLB, рынок After-5 (F5, счёт после 5 иннингов).
Ты работаешь не в вакууме: под тобой стоит детерминированная квант-формула (движок v42 + твой же редактируемый FormulaSpec), которая уже посчитала лямбды, вероятности и value% для каждой линии рынка. Твоя задача — не пересчитывать матан заново, а ПРИНЯТЬ РЕШЕНИЕ поверх готового расчёта, как это сделал бы живой аналитик, который сейчас реально поставит на это деньги.

Правила, которые нельзя нарушать:
1. Ты можешь поставить (action=bet) ТОЛЬКО на market/side/line, который реально присутствует в блоке "FORMULA SIGNALS" ниже (или который ты дополнительно проверил инструментом get_formula_output). Для team_total обязательно укажи team=home|away. Придумывать несуществующую линию — грубая ошибка, за это решение будет автоматически отклонено и заменено на pass. Доступные рынки: moneyline, total (матчевый), team_total (личный тотал команды). Фора/runline в пуле ставок НЕТ.
2. Ты никогда не указываешь размер ставки. Код всегда ставит фиксированные 50u. confidence_tier (low/medium/high) — только про уверенность в пике для UI/аудита, на размер не влияет. Не пиши суммы в rationale как будто ты их выбираешь.
3. Если сигналов нет, либо read-blocker (hard gap) в готовности данных, либо ты не уверен — выбирай action=pass. Пропуск — совершенно нормальный и часто ПРАВИЛЬНЫЙ результат анализа. Отдел аналитики не обязан ставить каждую игру.
4. Ты не можешь и не должен менять формулу отсюда — это работа другого агента (curation agent) и только человек может активировать изменения формулы. Твоя роль — решение по текущей формуле, а не её редактирование.
5. Используй инструменты, если тебе не хватает данных из брифинга: свежий состав, точный расчёт формулы, погода/судья, история последних решений по этой формуле. Не гадай — проверяй.
6. rationale — короткое (2-5 предложений), конкретное объяснение НА РУССКОМ: почему это value (или почему нет), какие риски (тонкий состав, судья с большой зоной, встречный ветер, усталость стартера и т.п.), почему выбран именно этот tier уверенности.
7. notify_brief — ОБЯЗАТЕЛЬНО: 1–3 коротких предложения НА РУССКОМ для Telegram-уведомления. Это понятная сводка именно по прогнозу ЭТОГО этапа (что ставим/пассуем и почему в одном дыхании). Без канцелярита, без сырых простыней λ/%/порогов, без копипасты rationale целиком. Пиши так, будто объясняешь коллеге за 10 секунд.
8. risk_flags — короткие технические теги на английском (например: "thin_lineup_data", "sp_fatigue", "small_sample_ump", "weather_neutral", "live_recalc_uncertain") — используй их честно, это часть аудита.
9. Ты видишь soft gaps (тонкие места данных) в брифинге — они не блокируют решение, но должны явно влиять на твою уверенность и rationale.
10. Судья: если в брифе указано имя HP и/или метрики UmpScorecards (accuracyΔx / consistency / favor / runImpact) — данные по судье ЕСТЬ. Soft gap "ump_zone:statcast_default" значит только что Statcast-роллап страйк-зоны подставлен лигой (нейтрально) — НЕ пиши «нет данных по судье», «судья отсутствует», «отсутствие данных по судье». Фраза про отсутствие судьи допустима только при soft gap "ump:default" (нет ни зоны, ни UmpScorecards) или если HP = n/a и метрики n/a.

Помни: это не игра и не текстовое упражнение. Ledger, который создаст твоё решение — это факт учёта, как будто деньги реально поставлены. Думай соответственно: консервативно, честно, без домыслов сверх того, что показывают данные и инструменты.`;

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return `${n.toFixed(digits)}%`;
}

function fmtNum(n: number | null | undefined, digits = 3): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return n.toFixed(digits);
}

function signalLine(b: ValueBet): string {
  const line = b.line != null ? ` line=${b.line}` : '';
  const team = b.team ? ` team=${b.team}` : '';
  return `- ${b.market}/${b.side}${team}${line} @${b.decimal_odds.toFixed(2)} | model=${fmtPct(b.model_prob)} implied=${fmtPct(b.implied_pct)} value=${fmtPct(b.value_pct)} roi=${fmtPct(b.roi_pct)}`;
}

export type CalibrationDigest = {
  days: number;
  n: number;
  winrate: number | null;
  roiPct: number;
  byConfidence: Record<string, { n: number; profit: number }>;
};

/**
 * Builds the initial human message: a pre-computed "decision brief" so the
 * agent almost never NEEDS a tool call for the common case, while still
 * having tools available for genuine deep dives.
 */
export function buildDecisionBrief(opts: {
  gameId: string;
  track: string;
  matchup: string;
  inputs: MatchupInputs;
  analysis: After5Analysis;
  readiness: ReadinessResult;
  formulaVersionLabel: string;
  calibration: CalibrationDigest | null;
}): string {
  const { inputs, analysis, readiness } = opts;
  const lines: string[] = [];
  lines.push(`# DECISION BRIEF — ${opts.matchup} (track=${opts.track}, gameId=${opts.gameId})`);
  lines.push(`Формула: ${opts.formulaVersionLabel} | режим симуляции: ${analysis.simulation_mode}`);
  lines.push('');
  lines.push('## MATCH DOSSIER');
  lines.push(`Стадион: ${inputs.venue ?? 'n/a'} | день/ночь: ${inputs.day_night ?? 'n/a'}`);
  lines.push(
    `Погода: ${fmtNum(inputs.temperature_f, 0)}°F, влажность ${fmtNum(inputs.humidity, 0)}%, ветер ${fmtNum(inputs.wind_speed_mph, 0)} mph`,
  );
  const zonePct =
    inputs.ump_strike_zone_pct != null
      ? fmtNum(inputs.ump_strike_zone_pct, 3)
      : 'league_default';
  const hasUsc =
    inputs.ump_accuracy_above_x != null ||
    inputs.ump_consistency != null ||
    inputs.ump_favor_abs != null ||
    inputs.ump_run_impact != null;
  lines.push(
    `Судья HP: ${inputs.ump_hp_name ?? 'n/a'} | страйк-зона=${zonePct}${inputs.ump_strike_zone_pct == null ? ' (Statcast rollup нет → нейтраль формулы)' : ''} | UmpScorecards=${hasUsc ? 'ok' : 'n/a'} accuracyΔx=${fmtNum(inputs.ump_accuracy_above_x, 2)} | consistency=${fmtNum(inputs.ump_consistency, 1)} | favor=${fmtNum(inputs.ump_favor_abs, 2)} | runImpact=${fmtNum(inputs.ump_run_impact, 2)}`,
  );
  lines.push(
    `Home: OPS=${fmtNum(inputs.home.ops)} SP_ERA=${fmtNum(inputs.home.sp_era)} barrel%=${fmtNum(inputs.home.barrel_pct)} hardhit%=${fmtNum(inputs.home.hardhit_pct)}`,
  );
  lines.push(
    `Away: OPS=${fmtNum(inputs.away.ops)} SP_ERA=${fmtNum(inputs.away.sp_era)} barrel%=${fmtNum(inputs.away.barrel_pct)} hardhit%=${fmtNum(inputs.away.hardhit_pct)}`,
  );
  if (inputs.live) {
    lines.push(
      `LIVE: iнн=${inputs.live.completed_innings} счёт=${inputs.live.away_score}-${inputs.live.home_score} (away-home)`,
    );
  }
  lines.push('');
  lines.push('## FORMULA OUTPUT');
  lines.push(
    `lambda_home=${fmtNum(analysis.lambda_home)} lambda_away=${fmtNum(analysis.lambda_away)} expected_total=${fmtNum(analysis.expected_total, 2)}`,
  );
  lines.push(
    `p_home_lead=${fmtPct(analysis.p_home_lead * 100)} p_tie=${fmtPct(analysis.p_tie * 100)} p_away_lead=${fmtPct(analysis.p_away_lead * 100)} p_over_4.5=${fmtPct(analysis.p_over_4_5 * 100)}`,
  );
  lines.push('');
  lines.push('## FORMULA SIGNALS (единственные линии, на которые можно ставить)');
  if (analysis.signals.length) {
    lines.push('signals (прошли порог signal_value_pct/signal_roi_pct):');
    analysis.signals.forEach((b) => lines.push(signalLine(b)));
  } else {
    lines.push('signals: (пусто)');
  }
  if (analysis.value_bets.length) {
    lines.push('value_bets (прошли только value_threshold_pct):');
    analysis.value_bets.forEach((b) => lines.push(signalLine(b)));
  } else {
    lines.push('value_bets: (пусто)');
  }
  lines.push('');
  lines.push('## READINESS');
  lines.push(`score=${readiness.score}/100 ready=${readiness.ready}`);
  if (readiness.hardGaps.length) lines.push(`hard_gaps: ${readiness.hardGaps.join(', ')}`);
  if (readiness.softGaps.length) lines.push(`soft_gaps (не блокируют, но снижают уверенность): ${readiness.softGaps.join(', ')}`);
  if (analysis.notes.length) {
    lines.push(`formula_notes: ${analysis.notes.slice(0, 10).join(', ')}`);
  }
  if (opts.calibration) {
    lines.push('');
    lines.push('## CALIBRATION (последние решения по текущей формуле)');
    lines.push(
      `За ${opts.calibration.days}д: n=${opts.calibration.n} winrate=${opts.calibration.winrate != null ? fmtPct(opts.calibration.winrate * 100) : 'n/a'} roi=${fmtPct(opts.calibration.roiPct)}`,
    );
    for (const [tier, m] of Object.entries(opts.calibration.byConfidence)) {
      lines.push(`  tier=${tier}: n=${m.n} profit=${fmtNum(m.profit, 1)}u`);
    }
  }
  lines.push('');
  lines.push(
    'Прими решение и верни его ТОЛЬКО через инструмент record_decision. Если данных не хватает — сначала используй другие инструменты, потом вызови record_decision.',
  );
  return lines.join('\n');
}
