import { describe, expect, it } from 'vitest';
import {
  buildUtopiaDriversLicense,
  CREDENTIALS_V2_CONTEXT_URL,
  VGW_CONTEXT_URL,
  type VerifiableCredential,
} from '../src/index.js';

type Subject = { driversLicense: Record<string, unknown> } & Record<string, unknown>;

function subjectOf(credential: VerifiableCredential): Subject {
  const subject = credential.credentialSubject;
  expect(subject).toBeTypeOf('object');
  expect(Array.isArray(subject)).toBe(false);
  return subject as Subject;
}

describe('buildUtopiaDriversLicense', () => {
  const credential = buildUtopiaDriversLicense({
    givenName: 'JOHN',
    familyName: 'SMITH',
    birthDate: '1988-04-19',
    documentNumber: 'F987654321',
    issuer: {
      id: 'did:key:zExampleIssuer',
      name: 'Utopia Department of Motor Vehicles',
    },
    validFrom: '2026-01-01T00:00:00Z',
    validUntil: '2032-01-01T00:00:00Z',
  });

  it('produces a VC 2.0 credential (validFrom/validUntil, v2 context first)', () => {
    const contexts = credential['@context'] as string[];
    expect(contexts[0]).toBe(CREDENTIALS_V2_CONTEXT_URL);
    expect(contexts).toContain('https://w3id.org/vdl/v1');
    expect(contexts).toContain('https://w3id.org/vdl/aamva/v1');
    expect(contexts).toContain(VGW_CONTEXT_URL);
    expect(credential.type).toEqual([
      'VerifiableCredential',
      'Iso18013DriversLicenseCredential',
    ]);
    expect(credential.validFrom).toBe('2026-01-01T00:00:00Z');
    expect(credential.validUntil).toBe('2032-01-01T00:00:00Z');
    expect(credential['issuanceDate']).toBeUndefined();
    expect(credential['expirationDate']).toBeUndefined();
  });

  it('carries no birthDateCommitment — the retired ZK-tier handle is gone', () => {
    // Since N4 the builder has no such input; the age predicate proves
    // against the hidden date1900 twin instead (MIGRATION §5, §10).
    expect(subjectOf(credential).driversLicense['birthDateCommitment']).toBeUndefined();
  });

  it('omits the subject id by default and defaults validity when not given', () => {
    const built = buildUtopiaDriversLicense({
      givenName: 'A',
      familyName: 'B',
      birthDate: '1990-01-01',
      documentNumber: 'X1',
      issuer: { id: 'did:key:zExample' },
    });
    const subject = subjectOf(built);
    expect(subject['id']).toBeUndefined();
    expect(subject['type']).toBe('LicensedDriver');
    expect(built.issuer).toBe('did:key:zExample');
    expect(typeof built.validFrom).toBe('string');
    expect(new Date(built.validUntil as string).getUTCFullYear()).toBe(
      new Date(built.validFrom as string).getUTCFullYear() + 6
    );
  });

  it('stamps mdoc-style age_over flags computed at issuance (validFrom)', () => {
    // Born 1988-04-19, issued 2026-01-01 → 37 years old: all flags true.
    const license = subjectOf(credential).driversLicense;
    expect(license['age_over_18']).toBe(true);
    expect(license['age_over_21']).toBe(true);
    expect(license['age_over_25']).toBe(true);

    // Born 2009-11-02 (the under-18 demo persona), issued 2026-01-01 → 16.
    const minor = buildUtopiaDriversLicense({
      givenName: 'NOA',
      familyName: 'LINDQVIST',
      birthDate: '2009-11-02',
      documentNumber: 'X2',
      issuer: { id: 'did:key:zExample' },
      validFrom: '2026-01-01T00:00:00Z',
    });
    const minorLicense = subjectOf(minor).driversLicense;
    expect(minorLicense['age_over_18']).toBe(false);
    expect(minorLicense['age_over_21']).toBe(false);
    expect(minorLicense['age_over_25']).toBe(false);
  });

  it('flips age_over flags exactly on the birthday, not a day-count approximation', () => {
    const build = (validFrom: string) =>
      subjectOf(
        buildUtopiaDriversLicense({
          givenName: 'A',
          familyName: 'B',
          birthDate: '2008-01-02',
          documentNumber: 'X3',
          issuer: { id: 'did:key:zExample' },
          validFrom,
        })
      ).driversLicense;
    // 18th birthday is 2026-01-02: false the day before, true on the day.
    expect(build('2026-01-01T00:00:00Z')['age_over_18']).toBe(false);
    expect(build('2026-01-02T00:00:00Z')['age_over_18']).toBe(true);
  });

  it('rejects a malformed birthDate instead of stamping wrong flags', () => {
    expect(() =>
      buildUtopiaDriversLicense({
        givenName: 'A',
        familyName: 'B',
        birthDate: '02/01/2008',
        documentNumber: 'X4',
        issuer: { id: 'did:key:zExample' },
      })
    ).toThrow(/birthDate must be 'YYYY-MM-DD'/);
  });

  it('defaults validity to midnight UTC so it is not a per-credential fingerprint', () => {
    // validFrom/validUntil are mandatory-disclosed in every derived proof;
    // millisecond-precision defaults would correlate presentations of the
    // same credential across verifiers.
    const input = {
      givenName: 'A',
      familyName: 'B',
      birthDate: '1990-01-01',
      documentNumber: 'X1',
      issuer: { id: 'did:key:zExample' },
    };
    const first = buildUtopiaDriversLicense(input);
    const second = buildUtopiaDriversLicense(input);

    expect(first.validFrom).toMatch(/T00:00:00(\.000)?Z$/);
    expect(first.validUntil).toMatch(/T00:00:00(\.000)?Z$/);
    // identical for credentials issued the same UTC day
    expect(second.validFrom).toBe(first.validFrom);
    expect(second.validUntil).toBe(first.validUntil);
  });
});
