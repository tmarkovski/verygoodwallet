import { createSignCryptosuite, createDiscloseCryptosuite } from '@digitalbazaar/bbs-2023-cryptosuite';
import { DataIntegrityProof } from '@digitalbazaar/data-integrity';
import jsigs from 'jsonld-signatures';
import { securityLoader } from '@digitalbazaar/security-document-loader';
import * as Bls12381Multikey from '@digitalbazaar/bls12-381-multikey';
import citizenshipContextV1 from '../credentials/contexts/citizenship-v1.json';
import citizenshipContextV3 from '../credentials/contexts/citizenship-v3.json';
import dataIntegrityContextV2 from '../credentials/contexts/data-integrity-v2.json';
import vdlContextV1 from '../credentials/contexts/vdl-v1.json';
import vdlAamvaContextV1 from '../credentials/contexts/vdl-aamva-v1.json';
import openBadgesContextV3 from '../credentials/contexts/openbadges-v3.json';
import retailCouponContectV1 from '../credentials/contexts/retail-coupon-v1.json';
import * as didKey from '@digitalbazaar/did-method-key';
import { CachedResolver } from '@digitalbazaar/did-io';
import { generateEncryptionKey, encryptData, decryptData } from './security';
const { purposes: { AssertionProofPurpose } } = jsigs;

const loader = securityLoader();
loader.addStatic('https://w3id.org/citizenship/v1', citizenshipContextV1);
loader.addStatic('https://w3id.org/citizenship/v3', citizenshipContextV3);
loader.addStatic('https://w3id.org/security/data-integrity/v2', dataIntegrityContextV2);
loader.addStatic('https://w3id.org/vdl/v1', vdlContextV1);
loader.addStatic('https://w3id.org/vdl/aamva/v1', vdlAamvaContextV1);
loader.addStatic('https://contexts.vcplayground.org/examples/retail-coupon/v1.json', retailCouponContectV1);
loader.addStatic('https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.2.json', openBadgesContextV3);
loader.addStatic('https://www.w3.org/ns/credentials/examples/v2', {
    "@context": {
        "@vocab": "https://www.w3.org/ns/credentials/examples#"
    }
});

const didKeyDriver = didKey.driver();
didKeyDriver.use({
    multibaseMultikeyHeader: 'zUC7',
    fromMultibase: Bls12381Multikey.from
});

const resolver = new CachedResolver();
resolver.use(didKeyDriver);
loader.setDidResolver(resolver);

export async function generateBbsKey(seed: Uint8Array): Promise<{ id: string, controller: string }> {
    const keyPair = await Bls12381Multikey.generateBbsKeyPair({
        algorithm: Bls12381Multikey.ALGORITHMS.BBS_BLS12381_SHA256,
        seed
    });

    keyPair['id'] = `did:key:${keyPair.publicKeyMultibase}#${keyPair.publicKeyMultibase}`;
    keyPair['controller'] = `did:key:${keyPair.publicKeyMultibase}`;
    keyPair['@context'] = 'https://w3id.org/security/multikey/v1';

    return keyPair;
}

export async function resolve({ did }: { did: string }) {
    const didDocument = await didKeyDriver.get({ did });
    return didDocument;
}

export async function signDocument(keyPair: any, document: any): Promise<any> {
    const cryptosuite = createSignCryptosuite();
    const unsignedCredential = { ...document };
    delete unsignedCredential.proof;

    const keyMultibase = {
        '@context': keyPair['@context'],
        type: 'Multikey',
        id: keyPair.id,
        controller: keyPair.controller,
        publicKeyMultibase: keyPair.publicKeyMultibase
    };

    // Prepare document loader
    loader.addStatic(keyPair.controller, keyMultibase);
    const documentLoader = loader.build();

    const date = '2023-03-01T21:29:24Z';
    const suite = new DataIntegrityProof({
        signer: keyPair.signer(), date, cryptosuite
    });

    let signedCredential;
    signedCredential = await jsigs.sign(unsignedCredential, {
        suite,
        purpose: new AssertionProofPurpose(),
        documentLoader
    });

    return signedCredential;
}

export async function deriveProof(signedDocument: any, selectivePointers: string[]): Promise<any> {
    const cryptosuite = createDiscloseCryptosuite({
        selectivePointers
    });
    const suite = new DataIntegrityProof({ cryptosuite });

    const documentLoader = loader.build();

    const revealed = await jsigs.derive(signedDocument, {
        suite,
        purpose: new AssertionProofPurpose(),
        documentLoader
    });
    return revealed;
}

export async function encryptDocument(credential: any, masterKey: Uint8Array): Promise<any> {
    // Clone the credential to avoid modifying the original
    const encryptedCredential = { ...credential };

    // Generate an encryption key from the master key
    const encryptionKey = await generateEncryptionKey(masterKey);

    // Function to encrypt a field
    const encryptField = async (field: any) => {
        const encryptedData = await encryptData(JSON.stringify(field), encryptionKey);
        return {
            "type": "EncryptedData",
            "encryptionAlgorithm": "AES-GCM",
            "ciphertext": encryptedData
        };
    };

    // Encrypt proof, credentialSubject, and issuer if they exist
    if (encryptedCredential.proof) {
        encryptedCredential.proof = await encryptField(encryptedCredential.proof);
    }
    if (encryptedCredential.credentialSubject) {
        encryptedCredential.credentialSubject = await encryptField(encryptedCredential.credentialSubject);
    }
    if (encryptedCredential.issuer) {
        encryptedCredential.issuer = await encryptField(encryptedCredential.issuer);
    }

    return encryptedCredential;
}

export async function decryptDocument(encryptedCredential: any, masterKey: Uint8Array): Promise<any> {
    // Clone the encrypted credential to avoid modifying the original
    const decryptedCredential = { ...encryptedCredential };

    // Generate the encryption key from the master key
    const encryptionKey = await generateEncryptionKey(masterKey);

    // Function to decrypt a field
    const decryptField = async (field: any) => {
        if (field.type === "EncryptedData") {
            const decryptedString = await decryptData(field.ciphertext, encryptionKey);
            return JSON.parse(decryptedString);
        }
        return field;
    };

    // Decrypt proof, credentialSubject, and issuer if they are encrypted
    decryptedCredential.proof = await decryptField(decryptedCredential.proof);
    decryptedCredential.credentialSubject = await decryptField(decryptedCredential.credentialSubject);
    decryptedCredential.issuer = await decryptField(decryptedCredential.issuer);

    return decryptedCredential;
}

