export type DeviceKind = 'ac3' | 'ac1' | 'dc' | 'induction' | 'synchronous' | 'dc_motor' | 'stepper' | 'step_driver' | 'ac_generator' | 'dc_generator' | 'diesel' | 'emy' | 'breaker' | 'breaker1' | 'contactor' | 'fuse' | 'thermal' | 'lamp' | 'push_no' | 'push_nc' | 'junction' | 'coil' | 'contact_no' | 'contact_nc' | 'contact_co' | 'timer_coil' | 'timer_no' | 'timer_nc' | 'field_winding'
  | 'switch' | 'selector2' | 'selector3' | 'emergency_stop' | 'limit_switch'
  | 'transformer1' | 'transformer3' | 'power_supply' | 'rectifier1' | 'rectifier3' | 'diode'
  | 'resistor' | 'rheostat' | 'potentiometer' | 'resistor_bank' | 'capacitor' | 'inductor'
  | 'terminal_block' | 'connector' | 'busbar' | 'net_label' | 'offpage' | 'earth' | 'neutral'
  | 'induction1' | 'ac_generator1' | 'solenoid' | 'brake' | 'clutch' | 'buzzer';
export type PortType = 'power' | 'shaft' | 'signal';
export interface PortDefinition { id: string; label: string; type: PortType; direction: 'in' | 'out' | 'both'; side: 'top' | 'right' | 'bottom' | 'left'; offset: number }
export interface ParameterDefinition { key: string; label: string; unit: string; min: number; max: number; step: number; default: number }
export interface DeviceDefinition { kind: DeviceKind; name: string; shortName: string; category: string; description: string; symbol: string; color: string; ports: PortDefinition[]; parameters: ParameterDefinition[]; size: { width: number; height: number } }
export interface Device { id: string; kind: DeviceKind; name: string; x: number; y: number; rotation?: 0 | 90 | 180 | 270; enabled: boolean; params: Record<string, number>; fieldMode?: 'independent' | 'shunt' | 'series' | 'compound'; windingRole?: 'shunt' | 'series'; hiddenLabel?: boolean; labelOffset?: Point }
export interface Point { x: number; y: number }
export interface Wire { id: string; from: string; fromPort: string; to: string; toPort: string; length: number; section: number; color?: string; waypoints?: Point[] }
export interface Project { version: 2; name: string; devices: Device[]; wires: Wire[] }
export interface DeviceState { energized: boolean; voltage: number; current: number; power: number; rpm: number; frequency: number; tripped: boolean; status: string; heat: number; coilEnergized?: boolean; windingVoltages?: number[]; windingCurrents?: number[]; connection?: string; fieldEnergized?: boolean; contactClosed?: boolean; timerOutput?: boolean; timerElapsed?: number; timerPending?: boolean }
export interface WireState { energized: boolean; current: number; voltage: number; direction?: 1 | -1 }
export interface SimulationEvent { time: number; level: 'info' | 'warning' | 'error'; message: string }
export interface SimulationState { time: number; devices: Record<string, DeviceState>; wires: Record<string, WireState>; events: SimulationEvent[] }
export interface ValidationIssue { level: 'warning' | 'error'; message: string; deviceId?: string }
