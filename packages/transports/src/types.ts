/**
 * Connection state for transports
 */
export type TransportState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error';
