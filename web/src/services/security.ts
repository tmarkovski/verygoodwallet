async function extract(salt: Uint8Array, input: Uint8Array): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, input));
}

async function expand(prk: Uint8Array, info: Uint8Array, keyLength: number = 32): Promise<Uint8Array> {
    let okm = new Uint8Array(keyLength);
    let t = new Uint8Array(0);
    let i = 0;

    while (okm.length < keyLength) {
        i++;
        const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const data = new Uint8Array(t.length + info.length + 1);
        data.set(t, 0);
        data.set(info, t.length);
        data.set([i], t.length + info.length);
        t = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
        okm.set(t.subarray(0, Math.min(t.length, keyLength - okm.length)), okm.length);
    }

    return okm;
}

async function hkdf(input: Uint8Array, dst: string, keyLength: number = 32): Promise<Uint8Array> {
    const salt = new Uint8Array(32); // Use a fixed-length salt of zeros
    const info = new TextEncoder().encode(dst);

    // Extract step
    const prk = await extract(salt, input);

    // Expand step
    return expand(prk, info, keyLength);
}

export async function generateEncryptionKey(seed: Uint8Array): Promise<CryptoKey> {
    const keyMaterial = await hkdf(seed, 'encryption_key', 32);
    return await crypto.subtle.importKey(
        'raw',
        keyMaterial,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptData(data: string, key: CryptoKey): Promise<string> {
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(data);
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedContent = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encodedData
    );

    const encryptedContentArray = new Uint8Array(encryptedContent);
    const resultArray = new Uint8Array(iv.length + encryptedContentArray.length);
    resultArray.set(iv, 0);
    resultArray.set(encryptedContentArray, iv.length);

    return btoa(new Uint8Array(resultArray).reduce((data, byte) => data + String.fromCharCode(byte), ''));
}

export async function decryptData(encryptedData: string, key: CryptoKey): Promise<string> {
    const encryptedBytes = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
    const iv = encryptedBytes.slice(0, 12);
    const data = encryptedBytes.slice(12);

    const decryptedContent = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        data
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedContent);
}
