import { useState } from "react";

export const PREFERENCE_KEYS = {
  askForOdometer: "vehicle.preferences.askForOdometer",
  quietHours: "vehicle.preferences.quietHours",
  units: "vehicle.preferences.units",
} as const;

export function readUnitsPreference(): "km" | "mi" {
  try {
    const stored = localStorage.getItem(PREFERENCE_KEYS.units);
    if (stored == null) return "km";
    try {
      return JSON.parse(stored) === "mi" ? "mi" : "km";
    } catch {
      return stored === "mi" ? "mi" : "km";
    }
  } catch {
    return "km";
  }
}

export function useLocalStoragePreference<T extends string | boolean>(
  key: string,
  fallback: T,
) {
  const [value, setValueState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored == null ? fallback : (JSON.parse(stored) as T);
    } catch {
      return fallback;
    }
  });

  function setValue(next: T) {
    setValueState(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Preferences remain usable for this session when persistent storage is unavailable.
    }
  }

  return [value, setValue] as const;
}
