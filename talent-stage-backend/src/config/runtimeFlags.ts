import { RowDataPacket } from 'mysql2';
import pool from './database';

export const isFeatureFlagEnabled = async (
  flagKey: string,
  fallback: boolean
): Promise<boolean> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT flag_value FROM feature_flags WHERE flag_key = ? LIMIT 1',
      [flagKey]
    );
    const row = rows[0];
    if (!row || row.flag_value === undefined || row.flag_value === null) return fallback;
    return Number(row.flag_value) === 1;
  } catch {
    return fallback;
  }
};

export const getSystemSettingValue = async (
  settingKey: string,
  fallback: string
): Promise<string> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1',
      [settingKey]
    );
    const row = rows[0];
    if (!row || row.setting_value === undefined || row.setting_value === null) return fallback;
    const value = String(row.setting_value).trim();
    return value === '' ? fallback : value;
  } catch {
    return fallback;
  }
};

export const getSystemSettingNumber = async (
  settingKey: string,
  fallback: number,
  bounds?: { min: number; max: number }
): Promise<number> => {
  const value = await getSystemSettingValue(settingKey, String(fallback));
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const floored = Math.floor(parsed);
  if (!bounds) return floored;
  return Math.max(bounds.min, Math.min(bounds.max, floored));
};

export const getSystemSettingFloat = async (
  settingKey: string,
  fallback: number,
  bounds?: { min: number; max: number }
): Promise<number> => {
  const value = await getSystemSettingValue(settingKey, String(fallback));
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (!bounds) return parsed;
  return Math.max(bounds.min, Math.min(bounds.max, parsed));
};
