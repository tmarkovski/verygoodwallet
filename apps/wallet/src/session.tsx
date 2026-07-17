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
import { currentTourStopId, subscribeTour } from "@vgw/tour";
import { inspect } from "./inspector/events";
import {
  addAccount,
  deleteAllData,
  getAccount,
  listAccounts,
  updateAccount,
  type AccountRecord,
} from "./services/db";
import {
  loginWithPasskey,
  registerPasskey,
  type MasterSecretSource,
} from "./services/webauthn";
import {
  TOUR_KEY_TTL_MS,
  clearTourKey,
  hasTourKey,
  stashTourKey,
  takeTourKey,
} from "./services/tourKey";

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
  /**
   * Aborted by `logout()`. Flows that hold the master secret across awaits
   * (issuance) tie themselves to this so locking cancels them — the secret
   * is zeroed in place, and nothing may keep running on revoked key material.
   */
  lockSignal: AbortSignal | null;
  /** True when the unlocked account uses the simulated (non-PRF) fallback. */
  simulated: boolean;
  lastAccountId: number | null;
  /**
   * True while a tour-key stash exists (see `keepUnlockedForTour`). Used by
   * the offer dialog so an accepted offer is never re-asked.
   */
  tourKeyStashed: boolean;
  /**
   * DEMO ONLY: with the user's explicit consent during a tour, stash the
   * live master secret in this tab's sessionStorage (TTL-bounded) so tour
   * hops don't each cost a passkey prompt. A production wallet would never
   * persist key material — the offer dialog says so.
   */
  keepUnlockedForTour(): void;
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

/**
 * Thrown by `createWallet` when the passkey and account were created but the
 * follow-up authentication failed. This happens when the browser rejects a
 * `credentials.get()` fired while the creation sheet is still tearing down
 * (seen on macOS without Touch ID), or because the `create()` call consumed
 * the transient user activation. The wallet exists and is usable — callers
 * should offer a click-driven `login(account)` instead of reporting failure.
 */
export class WalletCreatedError extends Error {
  readonly account: AccountRecord;

  constructor(account: AccountRecord, cause: unknown) {
    super("The wallet was created, but automatic sign-in was interrupted.", {
      cause,
    });
    this.name = "WalletCreatedError";
    this.account = account;
  }
}

interface UnlockedState {
  account: AccountRecord;
  masterSecret: Uint8Array;
  vaultKey: CryptoKey;
  source: MasterSecretSource;
  /** Aborted on lock so in-flight flows stop using this session's secret. */
  lockController: AbortController;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<AccountRecord[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState<UnlockedState | null>(null);
  const [lastAccountId, setLastAccountId] = useState<number | null>(readLastAccountId);
  const [tourKeyStashed, setTourKeyStashed] = useState<boolean>(hasTourKey);

  // Tour-key restore: every cross-origin hop of the tour reloads the app and
  // would otherwise cost a passkey prompt. If the user consented to the
  // stash (and the tour is still running, and the TTL hasn't lapsed),
  // silently rebuild the session from it on mount.
  useEffect(() => {
    const stash = takeTourKey();
    if (stash === null) return;
    let cancelled = false;
    void (async () => {
      const account = await getAccount(stash.accountId);
      if (account === undefined) {
        clearTourKey();
        setTourKeyStashed(false);
        return;
      }
      const vaultKey = await deriveVaultKey(stash.masterSecret);
      if (cancelled) return;
      setUnlocked((current) =>
        current ?? {
          account,
          masterSecret: stash.masterSecret,
          vaultKey,
          source: stash.source,
          lockController: new AbortController(),
        },
      );
      inspect.emit({
        label: "Session restored from tour key",
        data: {
          account: account.name,
          storage: "sessionStorage (tour consent, TTL-bounded)",
          warning: "demo behavior — a production wallet keeps keys in memory only",
        },
      });
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only: the stash is only ever written before a reload.
  }, []);

  // The stash lives and dies with the tour: ending the tour on this origin
  // revokes it immediately (the session itself stays unlocked — only the
  // persisted copy goes away).
  useEffect(
    () =>
      subscribeTour(() => {
        if (currentTourStopId() === null) {
          clearTourKey();
          setTourKeyStashed(false);
        }
      }),
    [],
  );

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
        lockController: new AbortController(),
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
      try {
        await unlock(account);
      } catch (err) {
        inspect.emit({
          label: "Auto sign-in after creation failed",
          data: {
            account: account.name,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        throw new WalletCreatedError(account, err);
      }
    },
    [refreshAccounts, unlock],
  );

  const keepUnlockedForTour = useCallback(() => {
    if (unlocked === null) return;
    const stashed = stashTourKey(
      unlocked.account.id,
      unlocked.masterSecret,
      unlocked.source,
    );
    setTourKeyStashed(stashed);
    if (stashed) {
      inspect.emit({
        label: "Master secret stashed for the tour",
        data: {
          storage: "sessionStorage, this tab only",
          ttlMinutes: TOUR_KEY_TTL_MS / 60_000,
          clearedOn: "lock, tour end, TTL expiry, wallet reset",
          warning: "demo behavior — a production wallet keeps keys in memory only",
        },
      });
    }
  }, [unlocked]);

  const logout = useCallback(() => {
    // Locking always revokes the tour stash — "lock" must mean locked.
    clearTourKey();
    setTourKeyStashed(false);
    if (unlocked !== null) {
      unlocked.masterSecret.fill(0);
      // Zeroing revokes the secret; aborting tells anything still awaiting a
      // network round-trip with it (issuance) to stop instead of continuing.
      unlocked.lockController.abort(new Error("The wallet was locked"));
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
      lockSignal: unlocked?.lockController.signal ?? null,
      simulated: unlocked?.source === "simulated",
      lastAccountId,
      tourKeyStashed,
      keepUnlockedForTour,
      createWallet,
      login: unlock,
      logout,
      refreshAccounts,
      resetWallet,
    }),
    [accounts, accountsError, unlocked, lastAccountId, tourKeyStashed, keepUnlockedForTour, createWallet, unlock, logout, refreshAccounts, resetWallet],
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
