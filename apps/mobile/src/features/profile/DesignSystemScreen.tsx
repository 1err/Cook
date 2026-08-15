import React from "react";
import { Text } from "react-native";
import { Button, IconButton, Screen } from "../../components";
import { spacing, typography } from "../../theme";

export function DesignSystemScreen() {
  return (
    <Screen scroll contentContainerStyle={{ gap: spacing.lg }}>
      <Text style={typography.title2}>Buttons</Text>
      <Button title="Primary" onPress={() => undefined} />
      <Button title="Secondary" variant="secondary" onPress={() => undefined} />
      <Button title="Ghost" variant="ghost" onPress={() => undefined} />
      <Button title="Destructive" variant="destructive" onPress={() => undefined} />
      <Button title="Loading" loading onPress={() => undefined} />
      <Button title="Disabled" disabled onPress={() => undefined} />
      <Text style={typography.title2}>Icon controls</Text>
      <IconButton icon="add" accessibilityLabel="Add recipe" onPress={() => undefined} />
      <IconButton
        icon="settings-outline"
        accessibilityLabel="Settings"
        disabled
        onPress={() => undefined}
      />
    </Screen>
  );
}
