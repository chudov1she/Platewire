/** RU Winline names → MLB abbreviations. */

export const WINLINE_NAME_TO_ABBR: Record<string, string> = {
  'Аризона Даймондбэкс': 'ARI',
  Аризона: 'ARI',
  'Атланта Брэйвз': 'ATL',
  Атланта: 'ATL',
  Атлетикс: 'OAK',
  Окленд: 'OAK',
  'Балтимор Ориолс': 'BAL',
  Балтимор: 'BAL',
  'Бостон Рэд Сокс': 'BOS',
  'Бостон Ред Сокс': 'BOS',
  Бостон: 'BOS',
  'Вашингтон Нэшионалс': 'WSH',
  Вашингтон: 'WSH',
  'Детройт Тайгерс': 'DET',
  Детройт: 'DET',
  'Канзас Сити Роялс': 'KC',
  'Канзас Сити': 'KC',
  Канзас: 'KC',
  'Кливленд Гардианс': 'CLE',
  Кливленд: 'CLE',
  'Колорадо Рокиз': 'COL',
  Колорадо: 'COL',
  'Лос-Анджелес Доджерс': 'LAD',
  'Лос-Анджелес Энджелс': 'LAA',
  'Л-А Доджерс': 'LAD',
  'Л-А Энджелс': 'LAA',
  'Л-А Эйнджелс': 'LAA',
  'Лос-Анджелес Эйнджелс': 'LAA',
  'Майами Марлинс': 'MIA',
  Майами: 'MIA',
  'Милуоки Брюэрс': 'MIL',
  Милуоки: 'MIL',
  'Миннесота Твинс': 'MIN',
  Миннесота: 'MIN',
  'Нью-Йорк Метс': 'NYM',
  'Нью-Йорк Янкиз': 'NYY',
  'Нью-Йорк Янкис': 'NYY',
  'Н-Й Метс': 'NYM',
  'Н-Й Янкиз': 'NYY',
  'Н-Й Янкис': 'NYY',
  'Питтсбург Пайретс': 'PIT',
  Питтсбург: 'PIT',
  'Сан-Диего Падрес': 'SD',
  'Сан-Диего': 'SD',
  'Сан-Франциско Джайентс': 'SF',
  'Сан-Франциско': 'SF',
  'Сент-Луис Кардиналс': 'STL',
  'Сент-Луис': 'STL',
  'Сиэтл Маринерс': 'SEA',
  Сиэтл: 'SEA',
  'Тампа-Бэй Рейс': 'TB',
  'Тампа-Бэй': 'TB',
  'Техас Рейнджерс': 'TEX',
  Техас: 'TEX',
  'Торонто Блю Джейс': 'TOR',
  Торонто: 'TOR',
  'Филадельфия Филлис': 'PHI',
  Филадельфия: 'PHI',
  'Хьюстон Астрос': 'HOU',
  Хьюстон: 'HOU',
  'Цинциннати Рэдс': 'CIN',
  Цинциннати: 'CIN',
  'Чикаго Кабс': 'CHC',
  'Чикаго Уайт Сокс': 'CWS',
};

export const ABBR_ALIASES: Record<string, string[]> = {
  OAK: ['OAK', 'ATH'],
  WSH: ['WSH', 'WAS', 'WSN'],
  TB: ['TB', 'TBR', 'TBD'],
  SD: ['SD', 'SDP'],
  SF: ['SF', 'SFG'],
  KC: ['KC', 'KCR'],
  CWS: ['CWS', 'CHW', 'SOX'],
  ARI: ['ARI', 'AZ'],
};

export function aliasesForAbbr(abbr: string): string[] {
  const abbrs = new Set<string>([abbr]);
  const direct = ABBR_ALIASES[abbr];
  if (direct) for (const a of direct) abbrs.add(a);
  for (const [canon, alts] of Object.entries(ABBR_ALIASES)) {
    if (alts.includes(abbr)) {
      abbrs.add(canon);
      for (const a of alts) abbrs.add(a);
    }
  }
  return Object.entries(WINLINE_NAME_TO_ABBR)
    .filter(([, a]) => abbrs.has(a))
    .map(([n]) => n);
}

export function normName(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .join(' ');
}

export function namesMatch(left: string, rightAliases: string[]): boolean {
  const target = normName(left);
  if (!target) return false;
  for (const alias of rightAliases) {
    const cand = normName(alias);
    if (!cand) continue;
    if (target === cand || target.includes(cand) || cand.includes(target)) {
      return true;
    }
  }
  return false;
}
