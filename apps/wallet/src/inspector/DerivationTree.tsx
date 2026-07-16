/**
 * Live key-derivation tree, rendered from `describeHierarchy()`.
 * Secret previews are SHA-256 hashes (first 8 hex chars) — never raw bytes.
 */

import { useEffect, useState } from "react";
import { describeHierarchy, type DerivationNode } from "@vgw/keys";
import { useSession } from "../session";
import { DEMO_SITE_ORIGINS } from "../services/demoSites";

/**
 * Origins shown as branches, matching what the flows actually derive
 * against: the deployed DMV for the per-issuer issuance-PoP branch (N2 —
 * `deriveIssuancePopSeed` is keyed by the issuer's exact origin; the local
 * demo issuer uses its own `vgw/v1/demo-issuer` branch, not shown here).
 *
 * There are NO verifier branches — that absence is the exhibit. The
 * pre-credkit wallet derived a presenter key per verifier origin; since the
 * credkit migration a presentation carries no holder key or DID at all, so
 * no per-verifier key exists to derive (retired at N4, not rotated).
 */
const ISSUER_ORIGINS = [DEMO_SITE_ORIGINS.dmv];

function Node({ node, root = false }: { node: DerivationNode; root?: boolean }) {
  return (
    <li className={root ? "" : "relative pl-4 before:absolute before:left-0 before:top-3 before:h-px before:w-2.5 before:bg-line-strong"}>
      <div className="flex flex-wrap items-baseline gap-x-2 py-0.5">
        {/* The root — where every key comes from — carries the gold mark. */}
        {root && (
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rotate-45 self-center bg-gold"
          />
        )}
        <span className="text-[13px] text-ink">{node.label}</span>
        {node.preview !== undefined && (
          <span className="rounded bg-gold-soft px-1.5 py-0.5 font-mono text-[10px] text-gold">
            #{node.preview}
          </span>
        )}
      </div>
      <div className="font-mono text-[10px] text-muted">{node.info}</div>
      {node.children.length > 0 && (
        <ul className="ml-1.5 mt-1 space-y-1.5 border-l border-line-strong">
          {node.children.map((child) => (
            <Node key={child.info} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function DerivationTree() {
  const { masterSecret, locked } = useSession();
  const [tree, setTree] = useState<DerivationNode | null>(null);

  useEffect(() => {
    let cancelled = false;
    void describeHierarchy({
      ...(masterSecret !== null ? { master: masterSecret } : {}),
      issuerOrigins: ISSUER_ORIGINS,
    }).then((root) => {
      if (!cancelled) setTree(root);
    });
    return () => {
      cancelled = true;
    };
  }, [masterSecret]);

  if (tree === null) {
    return <p className="text-xs text-muted">Deriving…</p>;
  }

  return (
    <div>
      {locked && (
        <p className="mb-3 rounded-lg bg-surface px-3 py-2 text-xs text-muted">
          Wallet locked — structure only. Unlock to see hashed previews of each
          derived secret.
        </p>
      )}
      <ul>
        <Node node={tree} root />
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        Previews are the first 8 hex chars of SHA-256(secret). Raw key material
        never reaches the UI.
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        Notice what the tree does NOT have: a branch per verifier. Presenting
        derives no key at all — the presentation carries no identifier — so
        there is nothing to grow here when you visit a shop or a rental
        counter. One link secret serves every issuer; it never leaves the
        wallet.
      </p>
    </div>
  );
}
