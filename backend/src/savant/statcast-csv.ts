import { parse } from 'csv-parse/sync';
import { floatOrNull, intOrNull } from './savant.client.js';

export type StatcastCsvRow = Record<string, string>;

export function parseStatcastCsv(text: string): StatcastCsvRow[] {
  const cleaned = text.replace(/^\uFEFF/, '').trim();
  if (!cleaned || cleaned === '239') {
    return [];
  }

  const records = parse(cleaned, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as StatcastCsvRow[];

  return records.filter(
    (row) =>
      intOrNull(row.at_bat_number) !== null &&
      intOrNull(row.pitch_number) !== null,
  );
}

export function mapStatcastRow(row: StatcastCsvRow) {
  return {
    atBatNumber: intOrNull(row.at_bat_number)!,
    pitchNumber: intOrNull(row.pitch_number)!,
    sourceBatterId: intOrNull(row.batter),
    sourcePitcherId: intOrNull(row.pitcher),
    pitchType: blankToNull(row.pitch_type),
    pitchName: blankToNull(row.pitch_name),
    gameDate: blankToNull(row.game_date),
    events: blankToNull(row.events),
    description: blankToNull(row.description) ?? blankToNull(row.des),
    inning: intOrNull(row.inning),
    inningHalf: blankToNull(row.inning_topbot),
    balls: intOrNull(row.balls),
    strikes: intOrNull(row.strikes),
    outs: intOrNull(row.outs_when_up),
    homeTeam: blankToNull(row.home_team),
    awayTeam: blankToNull(row.away_team),
    releaseSpeed: floatOrNull(row.release_speed),
    releasePosX: floatOrNull(row.release_pos_x),
    releasePosZ: floatOrNull(row.release_pos_z),
    pfxX: floatOrNull(row.pfx_x),
    pfxZ: floatOrNull(row.pfx_z),
    plateX: floatOrNull(row.plate_x),
    plateZ: floatOrNull(row.plate_z),
    launchSpeed: floatOrNull(row.launch_speed),
    launchAngle: floatOrNull(row.launch_angle),
    hitDistanceSc: floatOrNull(row.hit_distance_sc),
    estimatedBa: floatOrNull(row.estimated_ba_using_speedangle),
    estimatedWoba: floatOrNull(row.estimated_woba_using_speedangle),
    estimatedSlg: floatOrNull(row.estimated_slg_using_speedangle),
    wobaValue: floatOrNull(row.woba_value),
    babipValue: floatOrNull(row.babip_value),
    isoValue: floatOrNull(row.iso_value),
    deltaHomeWinExp: floatOrNull(row.delta_home_win_exp),
    deltaRunExp: floatOrNull(row.delta_run_exp),
    batSpeed: floatOrNull(row.bat_speed),
    swingLength: floatOrNull(row.swing_length),
    armAngle: floatOrNull(row.arm_angle),
    attackAngle: floatOrNull(row.attack_angle),
    rawRowJson: row,
  };
}

function blankToNull(value: string | undefined): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}
