import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { CookingStep } from "@cooking/shared";
import { useT } from "../../lib/i18n";
import { colors, typography } from "../../theme";
import { formatCookingTime, getRemainingSeconds } from "./cookingTime";

export function CookingTimerRing({ step }: { step: CookingStep }) {
  const t = useT();
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    if (step.state !== "timer_running") return;
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [step.state]);
  const seconds = step.state === "timer_paused"
    ? Math.max(0, step.paused_remaining_seconds ?? 0)
    : getRemainingSeconds(step.timer_ends_at, nowMs);
  const label = step.state === "timer_paused"
    ? t("cook.timer.paused")
    : seconds > 0 ? t("cook.timer.remaining") : t("cook.attention.needsAttention");
  const ratio = Math.min(1, seconds / Math.max(1, step.duration_seconds));
  const circumference = 2 * Math.PI * 48;

  return (
    <View accessible accessibilityLabel={`${label} ${formatCookingTime(seconds)}`} style={styles.wrap}>
      <Svg height={120} width={120} style={styles.svg}>
        <Circle cx={60} cy={60} fill="none" r={48} stroke={colors.divider} strokeWidth={8} />
        <Circle
          cx={60}
          cy={60}
          fill="none"
          r={48}
          rotation={-90}
          origin="60, 60"
          stroke={seconds === 0 ? colors.error : colors.terracotta}
          strokeDasharray={`${circumference * ratio} ${circumference}`}
          strokeLinecap="round"
          strokeWidth={8}
        />
      </Svg>
      <View pointerEvents="none" style={styles.value}>
        <Text style={styles.time} maxFontSizeMultiplier={1.4}>{formatCookingTime(seconds)}</Text>
        <Text style={styles.label}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 120, height: 120, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  svg: { position: "absolute" },
  value: { alignItems: "center" },
  time: { ...typography.title2, color: colors.ink, fontVariant: ["tabular-nums"] },
  label: { ...typography.caption, color: colors.mutedInk, textAlign: "center" },
});
