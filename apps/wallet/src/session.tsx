/**
 * Session context.
 *
 * The master secret and vault key live in MEMORY ONLY — a page refresh locks
 * the wallet and requires re-authentication with the passkey. localStorage
 * holds nothing but the last-used account id (a plain number).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { VAULT_INFO, deriveVaultKey } from "@vgw/keys";
import { inspect } from "./inspector/events";
import {
  addAccount,
  deleteAllData,
  listAccounts,
  updateAccount,
  type AccountRecord,
} from "./services/db";
import {
  loginWithPasskey,
  registerPasskey,
  type MasterSecretSource,
} from "./services/webauthn";

const LAST_ACCOUNT_KEY = "vgw:last-account-id";

function readLastAccountId(): number | null {
  try {
    const raw = localStorage.getItem(LAST_ACCOUNT_KEY);
    if (raw === null) return null;
    const id = Number(raw);
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}

export interface SessionValue {
  /** All accounts on this device; `null` while loading. */
  accounts: AccountRecord[] | null;
  /** Non-null when loading accounts failed (e.g. IndexedDB blocked/broken). */
  accountsError: string | null;
  /** The authenticated account, when unlocked. */
  account: AccountRecord | null;
  /** Memory-only master secret; never persisted, never rendered raw. */
  masterSecret: Uint8Array | null;
  /** AES-GCM vault key derived once per unlock. */
  vaultKey: CryptoKey | null;
  /** True whenever there is no live master secret. */
  locked: boolean;
  /** True when the unlocked account uses the simulated (non-PRF) fallback. */
  simulated: boolean;
  lastAccountId: number | null;
  /** Register a passkey, store the account, then authenticate (unlock). */
  createWallet(name: string): Promise<void>;
  /** Authenticate with an existing account's passkey and unlock. */
  login(account: AccountRecord): Promise<void>;
  /** Drop key material and lock the wallet. */
  logout(): void;
  refreshAccounts(): Promise<void>;
  /**
   * Danger zone: wipe the database and lock. `onBlocked` fires if another
   * connection holds the database open and the delete has to wait.
   */
  resetWallet(onBlocked?: () => void): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

interface UnlockedState {
  account: AccountRecord;
  masterSecret: Uint8Array;
  vaultKey: CryptoKey;
  source: MasterSecretSource;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<AccountRecord[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState<UnlockedState | null>(null);
  const [lastAccountId, setLastAccountId] = useState<number | null>(readLastAccountId);

  const refreshAccounts = useCallback(async () => {
    try {
      const all = await listAccounts();
      all.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
      setAccounts(all);
      setAccountsError(null);
    } catch (err) {
      // Surface the failure (IndexedDB blocked/corrupt) instead of stranding
      // `accounts` at null behind an eternal spinner. See Home's rendering.
      setAccountsError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshAccounts();
  }, [refreshAccounts]);

  const unlock = useCallback(
    async (target: AccountRecord) => {
      const result = await loginWithPasskey(target);
      const vaultKey = await deriveVaultKey(result.masterSecret);
      inspect.emit({
        label: "Vault key derived",
        data: { info: VAULT_INFO, algorithm: "AES-GCM-256", extractable: false },
      });
      const account = await updateAccount({
        ...result.account,
        lastUsedAt: Date.now(),
      });
      setUnlocked({
        account,
        masterSecret: result.masterSecret,
        vaultKey,
        source: result.source,
      });
      setLastAccountId(account.id);
      try {
        localStorage.setItem(LAST_ACCOUNT_KEY, String(account.id));
      } catch {
        // Storage unavailable (private mode); the session still works.
      }
      inspect.emit({
        label: "Wallet unlocked",
        data: { account: account.name, source: result.source },
      });
      await refreshAccounts();
    },
    [refreshAccounts],
  );

  const createWallet = useCallback(
    async (name: string) => {
      const { credentialId, prfSupported } = await registerPasskey(name);
      const now = Date.now();
      const account = await addAccount({
        name,
        credentialId,
        prfSupported,
        createdAt: now,
        lastUsedAt: now,
      });
      await refreshAccounts();
      // PRF is only evaluated during `get()`, so unlocking prompts once more.
      await unlock(account);
    },
    [refreshAccounts, unlock],
  );

  const logout = useCallback(() => {
    if (unlocked !== null) {
      unlocked.masterSecret.fill(0);
      inspect.emit({ label: "Wallet locked", data: { account: unlocked.account.name } });
    }
    setUnlocked(null);
  }, [unlocked]);

  const resetWallet = useCallback(async (onBlocked?: () => void) => {
    // Delete before locking: locking first unmounts Settings (its locked
    // guard redirects) while the delete may still be waiting on other tabs,
    // hiding the progress/blocked feedback.
    await deleteAllData(onBlocked);
    logout();
    try {
      localStorage.removeItem(LAST_ACCOUNT_KEY);
    } catch {
      // ignore
    }
    setLastAccountId(null);
    setAccounts([]);
    inspect.emit({ label: "Wallet data deleted" });
  }, [logout]);

  const value = useMemo<SessionValue>(
    () => ({
      accounts,
      accountsError,
      account: unlocked?.account ?? null,
      masterSecret: unlocked?.masterSecret ?? null,
      vaultKey: unlocked?.vaultKey ?? null,
      locked: unlocked === null,
      simulated: unlocked?.source === "simulated",
      lastAccountId,
      createWallet,
      login: unlock,
      logout,
      refreshAccounts,
      resetWallet,
    }),
    [accounts, accountsError, unlocked, lastAccountId, createWallet, unlock, logout, refreshAccounts, resetWallet],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return value;
}
