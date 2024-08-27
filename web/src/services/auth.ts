import { SecurityExtension, User, updateUser } from "./db/users";
import { generateBbsKey } from "./bbs";
import { useCallback } from 'react';

export type MasterKey = Uint8Array;

export function useAuth() {
    const register = useCallback(async (name: string): Promise<{ credential: any, extensions: any }> => {
        const options: CredentialCreationOptions = {
            publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)),
                rp: {
                    id: window.location.hostname,
                    name: "Very Good Wallet",
                },
                user: {
                    id: new TextEncoder().encode(name),
                    name: name,
                    displayName: name,
                },
                pubKeyCredParams: [
                    { type: "public-key", alg: -7 }, // ES256
                    { type: "public-key", alg: -8 }, // EdDSA
                    { type: "public-key", alg: -257 }, // RS256
                ],
                authenticatorSelection: {
                    requireResidentKey: true,
                    residentKey: "required",
                    userVerification: "required"
                },
                extensions: {
                    largeBlob: { support: "preferred" },
                    prf: {}
                } as any
            }
        };
        const credential = await navigator.credentials.create(options) as any;
        const extensions = credential.getClientExtensionResults();

        console.log(extensions);

        return { credential, extensions };
    }, []);

    const login = useCallback(async (user: User, dst?: string | undefined): Promise<{ credential: any, extensions: any, masterKey: MasterKey | undefined }> => {
        var extensionOptions = {};
        var masterKey = undefined;
        if (user.supportedExtension === SecurityExtension.LARGEBLOB) {
            if (!user.masterKeyCreated) {
                masterKey = crypto.getRandomValues(new Uint8Array(32));
                extensionOptions = {
                    largeBlob: { write: masterKey }
                };
            } else {
                extensionOptions = {
                    largeBlob: { read: true }
                }
            }
        } else if (user.supportedExtension === SecurityExtension.PRF) {
            extensionOptions = {
                prf: { eval: { first: new TextEncoder().encode(dst) } }
            }
        }

        const options: CredentialRequestOptions = {
            publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)),
                rpId: window.location.hostname,
                allowCredentials: [{
                    id: user.credentialId,
                    type: 'public-key',
                }],
                extensions: extensionOptions
            },
        };
        const credential = await navigator.credentials.get(options) as any;
        const extensions = credential.getClientExtensionResults();

        const { masterKeyCreated } = user;

        if (user.supportedExtension === SecurityExtension.LARGEBLOB && extensions.largeBlob?.blob) {
            masterKey = new Uint8Array(extensions.largeBlob?.blob);
        }

        if (user.supportedExtension === SecurityExtension.PRF && extensions.prf?.results?.first) {
            masterKey = new Uint8Array(extensions.prf.results.first);
        }

        if (user.supportedExtension === SecurityExtension.NONE) {
            masterKey = user.simulatedMasterKey;
        }

        if (!masterKeyCreated) {
            user.masterKeyCreated = true;
            const keyPair = await generateBbsKey(new Uint8Array(masterKey!))
            user.controller = keyPair.controller;
            updateUser(user);
        }

        return { credential, extensions, masterKey };
    }, []);

    return { register, login };
}