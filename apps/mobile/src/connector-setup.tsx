import { useEffect, useMemo, useState } from "react";
import { Linking, Modal, Pressable, StyleSheet } from "react-native";
import {
  connectorAuthorizedReturnUrl,
  connectorSetupFields,
  waitForConnectorAccountActive,
  type ConnectorCredentialSource,
  type ConnectorSelection,
  type CreateConnectorAccountResult,
  type OpenBotClient,
} from "@tryopenbot/client-runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollView } from "@/components/ui/scroll-view";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { SPACING } from "@/theme/globals";

export interface ConnectorSetupSheetProps {
  selection: ConnectorSelection;
  client: OpenBotClient;
  /** Control-service origin used to build the brokered-OAuth return URL. */
  controlOrigin?: string;
  /** Returns the configured account identifier so the client can bind it directly. */
  onComplete: (accountId: string) => void;
  onClose: () => void;
}

/**
 * Native new-account credential setup. Mirrors the web ConnectorSetupDialog:
 * credential-source choice, schema-driven form fields (API keys, custom
 * schemas), and the brokered-OAuth hand-off through the system browser.
 * Credentials go straight to the control service, never through chat.
 */
export function ConnectorSetupSheet({
  selection,
  client,
  controlOrigin,
  onComplete,
  onClose,
}: ConnectorSetupSheetProps) {
  const sources = selection.credential_sources ?? [];
  const [sourceTypeId, setSourceTypeId] = useState(sources[0]?.type_id ?? "");
  const source: ConnectorCredentialSource | undefined =
    sources.find((candidate) => candidate.type_id === sourceTypeId) ?? sources[0];
  const [displayName, setDisplayName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{
    result: CreateConnectorAccountResult;
    authorizationUrl: string;
  } | null>(null);

  const background = useColor("background");
  const border = useColor("border");
  const muted = useColor("textMuted");
  const destructive = useColor("destructive");
  const scrim = useColor("muted");

  // Close the loop without a manual Done: once Tilde flips the brokered
  // account active after the OAuth return, hand back to the agent directly.
  useEffect(() => {
    if (!pending) return;
    const watcher = new AbortController();
    void waitForConnectorAccountActive(client, {
      providerTypeId: selection.provider_type_id,
      accountId: pending.result.account.id,
      signal: watcher.signal,
    }).then((account) => {
      if (!account || watcher.signal.aborted) return;
      onComplete(account.id);
    });
    return () => watcher.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the pending account only
  }, [pending?.result.account.id]);

  const resourceFields = useMemo(
    () => connectorSetupFields(source?.resource_server_schema),
    [source],
  );
  const userFields = useMemo(
    () => (source?.requires_brokering ? [] : connectorSetupFields(source?.user_credential_schema)),
    [source],
  );
  const fields = [...resourceFields, ...userFields];
  const nameRequired = !(source?.supports_auto_display_name ?? false);
  const missingRequired =
    (nameRequired && !displayName.trim()) ||
    fields.some((field) => field.required && !values[field.key]?.trim());

  async function submit(): Promise<void> {
    if (!source || missingRequired || submitting) return;
    setSubmitting(true);
    setError("");
    const bucket = (candidates: typeof resourceFields): Record<string, unknown> | undefined => {
      const entries = candidates
        .map((field) => [field.key, values[field.key]?.trim() ?? ""] as const)
        .filter(([, value]) => value.length > 0);
      return entries.length > 0 ? Object.fromEntries(entries) : undefined;
    };
    try {
      const resourceServerValues = bucket(resourceFields);
      const userCredentialValues = bucket(userFields);
      const result = await client.createConnectorAccount({
        providerTypeId: selection.provider_type_id,
        credentialSourceTypeId: source.type_id,
        displayName: displayName.trim() || `${selection.provider_name} account`,
        ...(resourceServerValues ? { resourceServerValues } : {}),
        ...(userCredentialValues ? { userCredentialValues } : {}),
        ...(controlOrigin
          ? { returnUrl: connectorAuthorizedReturnUrl(controlOrigin, "mobile") }
          : {}),
      });
      if (result.status === "authorize" && result.authorization_url) {
        setPending({ result, authorizationUrl: result.authorization_url });
        setSubmitting(false);
        void Linking.openURL(result.authorization_url);
        return;
      }
      onComplete(result.account.id);
    } catch (reason) {
      setSubmitting(false);
      setError(reason instanceof Error ? reason.message : "Connector setup failed");
    }
  }

  return (
    <Modal animationType="slide" transparent onRequestClose={onClose} visible>
      <View style={[styles.backdrop, { backgroundColor: scrim }]}>
        <View style={[styles.sheet, { backgroundColor: background, borderColor: border }]}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text variant="subtitle">Add a {selection.provider_name} account</Text>
            {pending ? (
              <>
                <Text variant="body" style={{ color: muted }}>
                  Waiting for {selection.provider_name} authorization… Finish signing in with your
                  browser, then come back and tap Done.
                </Text>
                <View style={styles.actions}>
                  <Button
                    label="Reopen authorization"
                    variant="outline"
                    onPress={() => void Linking.openURL(pending.authorizationUrl)}
                  >
                    Reopen authorization
                  </Button>
                  <Button label="Done" onPress={() => onComplete(pending.result.account.id)}>
                    Done
                  </Button>
                </View>
              </>
            ) : (
              <>
                {sources.length > 1 ? (
                  <View style={styles.sourceList}>
                    <Text variant="caption" style={{ color: muted }}>
                      Sign-in method
                    </Text>
                    {sources.map((candidate) => (
                      <Pressable
                        accessibilityRole="button"
                        key={candidate.type_id}
                        onPress={() => {
                          setSourceTypeId(candidate.type_id);
                          setValues({});
                        }}
                        style={[
                          styles.sourceRow,
                          { borderColor: border },
                          candidate.type_id === source?.type_id && styles.sourceRowActive,
                        ]}
                      >
                        <Text variant="caption">{candidate.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {source?.documentation ? (
                  <Text variant="caption" style={{ color: muted }}>
                    {source.documentation}
                  </Text>
                ) : null}
                {nameRequired ? (
                  <Input
                    accessibilityLabel="Account name"
                    label="Account name"
                    placeholder={
                      source?.display_name_description || "Label this account — e.g. work, personal"
                    }
                    value={displayName}
                    onChangeText={setDisplayName}
                  />
                ) : null}
                {fields.map((field) => (
                  <Input
                    accessibilityLabel={field.label}
                    autoCapitalize="none"
                    autoCorrect={false}
                    key={field.key}
                    label={field.required ? field.label : `${field.label} (optional)`}
                    placeholder={field.description ?? field.key}
                    secureTextEntry={field.secret}
                    type={field.multiline ? "textarea" : "input"}
                    value={values[field.key] ?? ""}
                    onChangeText={(value) =>
                      setValues((current) => ({ ...current, [field.key]: value }))
                    }
                  />
                ))}
                {source?.requires_brokering && fields.length === 0 ? (
                  <Text variant="caption" style={{ color: muted }}>
                    You will sign in with your browser to authorize this account.
                  </Text>
                ) : null}
                {error ? (
                  <Text variant="caption" style={{ color: destructive }}>
                    {error}
                  </Text>
                ) : null}
                <View style={styles.actions}>
                  <Button disabled={submitting} label="Cancel" variant="ghost" onPress={onClose}>
                    Cancel
                  </Button>
                  <Button
                    disabled={submitting || missingRequired || !source}
                    label={source?.requires_brokering ? "Allow access" : "Connect"}
                    loading={submitting}
                    onPress={() => void submit()}
                  >
                    {source?.requires_brokering ? "Allow access" : "Connect"}
                  </Button>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// Layout only; colors resolve through useColor above.
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "82%",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  content: { gap: SPACING.md, padding: SPACING.lg },
  sourceList: { gap: SPACING.xs },
  sourceRow: {
    padding: SPACING.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  sourceRowActive: { borderWidth: 1.5 },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: SPACING.sm,
  },
});
