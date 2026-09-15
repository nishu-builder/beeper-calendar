import { invoke, isTauri } from "@tauri-apps/api/core";
import { AppState, Service, Settings, Store, Transport } from "../core/types";
export class HttpError extends Error { constructor(public status: number, service: string) {
  super(status === 401 || status === 403 ? service + " access was denied. Reconnect in Settings and check repository permissions." : status === 404 ? service + " resource was not found. Check the repository, branch and calendar." : status === 429 ? service + " is rate limited. Wait before retrying." : service + " returned HTTP " + status + ". Check the linked service and retry.");
} }
export class DesktopTransport implements Transport {
  constructor(private settings: Settings) {}
  async request<T>(service: Service, path: string, method = "GET", body?: unknown): Promise<T> {
    if (!isTauri()) throw new Error("Live connections are available in the desktop app. This browser preview uses demo mode.");
    const baseUrl = service === "github" ? "https://api.github.com" : service === "beeper" ? this.settings.beeperUrl : this.settings.ollamaUrl;
    const response = await invoke<{ status: number; body: T }>("service_request", { request: { service, baseUrl, path, method, body } });
    if (response.status >= 400) throw new HttpError(response.status, service);
    return response.body;
  }
}
export const desktopStore: Store = {
  async load() { return isTauri() ? invoke<AppState | null>("load_state") : JSON.parse(localStorage.getItem("beeper-calendar-demo") || "null"); },
  async save(state) {
    if (isTauri()) await invoke("save_state", { state });
    else localStorage.setItem("beeper-calendar-demo", JSON.stringify(state));
  }
};
export const native = {
  isDesktop: isTauri(),
  clipboard: () => isTauri() ? invoke<string>("read_clipboard") : navigator.clipboard.readText(),
  saveSecret: (service: string, token: string) => invoke("save_secret", { service, token }),
  connectBeeper: (baseUrl: string) => invoke("beeper_authorize", { baseUrl }),
  credentials: () => isTauri() ? invoke<{ beeper: boolean; github: boolean }>("credential_status") : Promise.resolve({ beeper: false, github: false }),
  openLink: (url: string) => isTauri() ? invoke("open_link", { url }) : Promise.resolve(window.open(url, "_blank", "noopener,noreferrer")),
};
