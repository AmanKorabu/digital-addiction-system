const MAX_LOGS = 25;

const initialState = {
  uid: null,
  role: "",
  status: "",
  network: "unknown",
  monitoring: "stopped",
  registration: "not started",
  registrationError: "",
  deviceId: "",
  presence: "not started",
  presenceWrite: "not tried",
  presenceError: "",
  heartbeat: "not sent",
  heartbeatAt: 0,
  heartbeatError: "",
  logs: [],
};

let state = { ...initialState };
const listeners = new Set();

const emit = () => listeners.forEach((listener) => listener(state));

export const getDiag = () => state;

export const setDiag = (patch) => {
  state = { ...state, ...patch };
  emit();
};

export const logDiag = (message) => {
  const line = `${new Date().toLocaleTimeString()}  ${message}`;
  state = { ...state, logs: [line, ...state.logs].slice(0, MAX_LOGS) };
  emit();
};

export const resetDiag = () => {
  state = { ...initialState, logs: state.logs };
  emit();
};

export const subscribeDiag = (listener) => {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
};

export const errorText = (error) =>
  `${error?.code ? `${error.code}: ` : ""}${error?.message || String(error)}`;