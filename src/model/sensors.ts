import type { Device, DeviceKind } from './types';

export type SensorKind = Extract<DeviceKind, 'voltage_sensor' | 'current_sensor' | 'power_sensor' | 'phase_sensor' | 'speed_sensor' | 'process_sensor'>;
export interface SensorFunction { value: number; label: string; symbol: string; unit: string }

const functions: Record<SensorKind, readonly SensorFunction[]> = {
  voltage_sensor: [
    { value: 0, label: 'Điện áp', symbol: 'V', unit: 'V' },
    { value: 1, label: 'Tần số', symbol: 'Hz', unit: 'Hz' },
  ],
  current_sensor: [{ value: 0, label: 'Dòng điện', symbol: 'A', unit: 'A' }],
  power_sensor: [
    { value: 0, label: 'Công suất tác dụng', symbol: 'W', unit: 'W' },
    { value: 1, label: 'Công suất phản kháng', symbol: 'var', unit: 'var' },
    { value: 2, label: 'Công suất biểu kiến', symbol: 'VA', unit: 'VA' },
    { value: 3, label: 'Hệ số công suất', symbol: 'cosφ', unit: '' },
    { value: 4, label: 'Điện năng', symbol: 'kWh', unit: 'kWh' },
  ],
  phase_sensor: [
    { value: 0, label: 'Thứ tự pha', symbol: 'L↻', unit: '' },
    { value: 1, label: 'Hiện diện các pha', symbol: '3~', unit: '' },
  ],
  speed_sensor: [
    { value: 0, label: 'Tốc độ quay', symbol: 'n', unit: 'rpm' },
    { value: 1, label: 'Chiều quay', symbol: '↻', unit: '' },
  ],
  process_sensor: [
    { value: 0, label: 'Nhiệt độ', symbol: 'T', unit: '°C' },
    { value: 1, label: 'Áp suất', symbol: 'p', unit: 'bar' },
    { value: 2, label: 'Mức chất lỏng', symbol: 'L', unit: '%' },
    { value: 3, label: 'Lưu lượng', symbol: 'F', unit: 'm³/h' },
    { value: 4, label: 'Tiệm cận', symbol: 'B', unit: '' },
    { value: 5, label: 'Vị trí', symbol: 'x', unit: 'mm' },
    { value: 6, label: 'Độ ẩm', symbol: 'RH', unit: '%' },
    { value: 7, label: 'Độ rọi', symbol: 'E', unit: 'lx' },
    { value: 8, label: 'Độ rung', symbol: 'v', unit: 'mm/s' },
    { value: 9, label: 'Mômen', symbol: 'τ', unit: 'N·m' },
  ],
};

export const sensorKinds = new Set<DeviceKind>(Object.keys(functions) as SensorKind[]);
export function isSensorKind(kind: DeviceKind): kind is SensorKind { return sensorKinds.has(kind); }
export function sensorFunctions(kind: DeviceKind): readonly SensorFunction[] { return isSensorKind(kind) ? functions[kind] : []; }
export function getSensorFunction(kind: DeviceKind, params: Record<string, number> = {}): SensorFunction {
  const options = sensorFunctions(kind);
  if (!options.length) throw new Error(`Phần tử ${kind} không có chức năng đo lường.`);
  return options.find(option => option.value === params.sensorFunction) ?? options[0];
}

/** Compare a user-supplied virtual process input. The caller must separately gate
 * this output with a complete A1–A2 supply circuit. Values are not physical
 * measurements of pressure, temperature, etc. from another component.
 * An active high output releases below threshold − hysteresis; low is symmetric. */
export function processSensorOutput(device: Device, previousActive = false): boolean {
  if (device.kind !== 'process_sensor') return false;
  const { inputValue = 0, threshold = 50, hysteresis = 1, comparison = 0 } = device.params;
  if (![inputValue, threshold, hysteresis].every(Number.isFinite) || hysteresis < 0 || ![0, 1].includes(comparison)) return false;
  return comparison === 1
    ? inputValue <= threshold + (previousActive ? hysteresis : 0)
    : inputValue >= threshold - (previousActive ? hysteresis : 0);
}
