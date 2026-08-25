"use client";

import { useEffect, useId, useState } from "react";
import styles from "./ImportFlow.module.css";

const MAX_DURATION_SECONDS = 86_400;

interface Props {
  seconds: number | null | undefined;
  onChange: (next: number | null) => void;
  ariaLabel: string;
  minutesAriaLabel: string;
  secondsAriaLabel: string;
  validationMessage?: string;
  onValidityChange?: (valid: boolean) => void;
}

function isValidDuration(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_DURATION_SECONDS;
}

function durationParts(value: number | null | undefined): [string, string] {
  if (!isValidDuration(value)) return ["", ""];
  return [String(Math.floor(value / 60)), String(value % 60).padStart(2, "0")];
}

export function DurationField({
  seconds,
  onChange,
  ariaLabel,
  minutesAriaLabel,
  secondsAriaLabel,
  validationMessage,
  onValidityChange,
}: Props) {
  const initial = durationParts(seconds);
  const [minutes, setMinutes] = useState(initial[0]);
  const [secondsPart, setSecondsPart] = useState(initial[1]);
  const [valid, setValid] = useState(isValidDuration(seconds));
  const errorId = useId();

  useEffect(() => {
    const [nextMinutes, nextSeconds] = durationParts(seconds);
    setMinutes(nextMinutes);
    setSecondsPart(nextSeconds);
    setValid(isValidDuration(seconds));
  }, [seconds]);

  useEffect(() => {
    onValidityChange?.(valid);
  }, [onValidityChange, valid]);

  const update = (nextMinutes: string, nextSeconds: string) => {
    setMinutes(nextMinutes);
    setSecondsPart(nextSeconds);

    if (nextMinutes.trim() === "" || nextSeconds.trim() === "") {
      setValid(false);
      return;
    }

    const parsedMinutes = Number(nextMinutes);
    const parsedSeconds = Number(nextSeconds);
    if (
      !Number.isInteger(parsedMinutes) ||
      !Number.isInteger(parsedSeconds) ||
      parsedMinutes < 0 ||
      parsedSeconds < 0
    ) {
      setValid(false);
      return;
    }

    const nextTotal = Math.min(
      MAX_DURATION_SECONDS,
      parsedMinutes * 60 + Math.min(59, parsedSeconds),
    );
    if (nextTotal < 1) {
      setValid(false);
      return;
    }

    const [clampedMinutes, clampedSeconds] = durationParts(nextTotal);
    setMinutes(clampedMinutes);
    setSecondsPart(clampedSeconds);
    setValid(true);
    onChange(nextTotal);
  };

  return (
    <div>
      <div className={styles.durationField} role="group" aria-label={ariaLabel}>
        <input
          type="number"
          min={0}
          max={1_440}
          value={minutes}
          onChange={(event) => update(event.target.value, secondsPart)}
          aria-label={minutesAriaLabel}
          aria-invalid={!valid}
          aria-describedby={!valid && validationMessage ? errorId : undefined}
        />
        <span aria-hidden="true">:</span>
        <input
          type="number"
          min={0}
          max={59}
          value={secondsPart}
          onChange={(event) => update(minutes, event.target.value)}
          aria-label={secondsAriaLabel}
          aria-invalid={!valid}
          aria-describedby={!valid && validationMessage ? errorId : undefined}
        />
      </div>
      {!valid && validationMessage ? (
        <p id={errorId} className={styles.durationError} role="alert">
          {validationMessage}
        </p>
      ) : null}
    </div>
  );
}
