import {
  createOpenBotClient,
  createOpenBotRuntime,
  type ClientInstallation,
  type OpenBotClient,
  type OpenBotRuntime,
} from "@tryopenbot/client-runtime";
import { fetch as expoFetch } from "expo/fetch";
import { createNativeAuth } from "../auth/native-auth";

export interface MobileOpenBotRuntime extends OpenBotRuntime {
  readonly controlOrigin: string;
  getAccessToken(): Promise<string | undefined>;
}

export function createMobileRuntime(installation: ClientInstallation): MobileOpenBotRuntime {
  let client: OpenBotClient;
  const auth = createNativeAuth(installation, () => client);
  client = createOpenBotClient({
    baseUrl: installation.control_origin,
    fetch: expoFetch,
    getAccessToken: () => auth.getAccessToken(),
    missionControlTransport: "native",
  });
  return {
    ...createOpenBotRuntime({ client, auth }),
    controlOrigin: installation.control_origin,
    getAccessToken: () => auth.getAccessToken(),
  };
}
