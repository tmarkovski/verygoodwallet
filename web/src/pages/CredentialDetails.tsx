import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getCredential, removeCredential, Credential } from '../services/db/credentials';
import { useLayout } from '../contexts/LayoutContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrashCan, faShareNodes, faLock, faUnlock, faArrowRight } from '@fortawesome/free-solid-svg-icons';
import ShareCredential from '../components/ShareCredential';
import { deriveProof } from '../services/bbs';
import Modal from '../components/Modal';
import Image from '../components/Image';
import { decryptDocument } from '../services/bbs';
import { useAuth } from '../services/auth';
import { useUser } from '../contexts/UserContext';
import JsonDisplay from '../components/JsonDisplay';
import { useLogging } from '../hooks/logging';

const CredentialDetails: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const [credential, setCredential] = useState<Credential | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { setTitle, setCommandButtons, setMessage, setIsBusy, setSubtitle, setHelpComponent } = useLayout();
    const navigate = useNavigate();
    const [showShareModal, setShowShareModal] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [modalData, setModalData] = useState<any | null>(null);
    const { currentUser } = useUser();
    const [decryptedCredential, setDecryptedCredential] = useState<any | null>(null);
    const { login } = useAuth();
    const { logError } = useLogging();

    // Effect for fetching the credential
    useEffect(() => {
        const fetchCredential = async () => {
            setLoading(true);
            try {
                if (id) {
                    const fetchedCredential = await getCredential(parseInt(id, 10));
                    if (fetchedCredential) {
                        setCredential(fetchedCredential);
                    } else {
                        setError('Credential not found');
                    }
                } else {
                    setError('Invalid credential ID');
                }
            } catch (err) {
                setError('Error fetching credential');
            } finally {
                setLoading(false);
            }
        };

        fetchCredential();
    }, [id]);

    // Effect for setting title and subtitle
    useEffect(() => {
        if (credential) {
            setTitle(credential.data.name || 'Credential Details');
            setSubtitle(credential.data.description || '');
        }

        return () => {
            // Only clear the title and subtitle when the component unmounts
            if (!id) {
                setTitle('');
                setSubtitle('');
            }
        };
    }, [credential, setTitle, setSubtitle, id]);

    // Effect for setting command buttons
    useEffect(() => {
        setCommandButtons([
            <div key="command-buttons" className="inline-flex rounded-md" role="group">
                <button
                    key="share"
                    onClick={() => setShowShareModal(true)}
                    className={`px-4 py-2 text-sm font-medium bg-white border border-gray-200 rounded-l-lg ${decryptedCredential
                            ? 'text-purple-600 hover:bg-gray-100 hover:text-purple-700 focus:z-10 focus:ring-2 focus:ring-purple-700 focus:text-purple-700'
                            : 'text-gray-400 opacity-50 cursor-not-allowed'
                        }`}
                    title="Share Credential"
                    disabled={!decryptedCredential}
                >
                    <FontAwesomeIcon icon={faShareNodes} className="mr-2" />
                    Share
                </button>
                {!decryptedCredential && (
                    <button
                        key="encrypt"
                        onClick={handleDecrypt}
                        className="px-4 py-2 text-sm font-medium text-gray-900 bg-white border-t border-b border-gray-200 hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-2 focus:ring-blue-700 focus:text-blue-700"
                        title="Decrypt Credential"
                    >
                        <FontAwesomeIcon icon={faUnlock} className="mr-2" />
                        Decrypt
                    </button>
                )}
                <button
                    key="delete"
                    onClick={handleDelete}
                    className="px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-r-lg hover:bg-red-100 hover:text-red-700 focus:z-10 focus:ring-2 focus:ring-red-700 focus:text-red-700"
                    title="Delete Credential"
                >
                    <FontAwesomeIcon icon={faTrashCan} className="mr-2" />
                    Delete
                </button>
            </div>
        ]);

        return () => {
            setCommandButtons([]);
        };
    }, [credential, decryptedCredential, setCommandButtons]);

    const handleDelete = async () => {
        setIsBusy(true);
        setTimeout(async () => {
            const confirmed = window.confirm(`Are you sure you want to delete the credential "${credential?.data.name || 'Unnamed Credential'}"?`);

            if (confirmed) {
                try {
                    await removeCredential(credential!.id!);
                    setMessage({ text: 'Credential deleted successfully', type: 'success' });
                    navigate('/credentials'); // Redirect to credentials list after deletion
                } catch (err) {
                    setError('Error deleting credential');
                    setMessage({ text: 'Error deleting credential', type: 'error' });
                }
            }
            setIsBusy(false);
        }, 100);
    }

    const handleShare = async (selectedFields: string[]) => {
        try {
            let fieldsWithIssuer = [...selectedFields];

            const issuerFields = ['id', 'type', 'name'];
            issuerFields.forEach(field => {
                if (decryptedCredential?.issuer?.[field]) {
                    fieldsWithIssuer.push(`/issuer/${field}`);
                }
            });

            const proof = await deriveProof(decryptedCredential, fieldsWithIssuer);
            // You might want to do something with the proof here
            setMessage({ text: 'Proof derived successfully', type: 'success' });
            setModalData(proof);
            setShowModal(true);
        } catch (error) {
            console.log(error);
            setMessage({ text: `${error}`, type: 'error' });
        }
        setShowShareModal(false);
    };



    const handleDecrypt = useCallback(async () => {
        try {
            setIsBusy(true);
            if (!credential) {
                throw new Error('No credential to decrypt');
            }
            const { masterKey } = await login(currentUser!);
            if (!masterKey) {
                throw new Error('No master key available for decryption');
            }
            const decrypted = await decryptDocument(credential.data, masterKey);
            setDecryptedCredential(decrypted);
            setMessage({ text: 'Credential decrypted successfully', type: 'success' });
        } catch (error) {
            logError('Error decrypting credential', error as Error, 'CredentialDetails');
            console.error('Error decrypting credential:', error);
            setMessage({ text: 'Error decrypting credential', type: 'error' });
        } finally {
            setIsBusy(false);
        }
    }, [credential, currentUser, setMessage, setIsBusy]);

    const renderProofInfo = () => {
        const currentCredential = decryptedCredential || credential?.data;
        const isEncrypted = currentCredential?.proof?.type === 'EncryptedData';
        return (
            <div className="px-4 py-6 sm:grid sm:grid-cols-4 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-gray-900 sm:col-span-1">Security Signature</dt>
                <dd className="mt-1 text-sm leading-6 text-gray-500 sm:col-span-3 sm:mt-0">
                    {isEncrypted ? (
                        <div className="ml-8 flex items-center text-gray-400">
                            <FontAwesomeIcon icon={faLock} className="mr-2" />
                            <span>Encrypted Data</span>
                        </div>
                    ) : currentCredential?.proof ? (
                        <JsonDisplay data={currentCredential.proof} />
                    ) : (
                        <span>No proof available</span>
                    )}
                </dd>
            </div>
        );
    };

    const renderSubjectInfo = () => {
        const currentCredential = decryptedCredential || credential?.data;
        const isEncrypted = currentCredential?.credentialSubject?.type === 'EncryptedData';
        return (
            <div className="px-4 py-6 sm:grid sm:grid-cols-4 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-gray-900 sm:col-span-1">Credential Subject</dt>
                <dd className="mt-1 text-sm leading-6 text-gray-500 sm:col-span-3 sm:mt-0">
                    {isEncrypted ? (
                        <div className="ml-8 flex items-center text-gray-400">
                            <FontAwesomeIcon icon={faLock} className="mr-2" />
                            <span>Encrypted Data</span>
                        </div>
                    ) : (
                        <JsonDisplay data={currentCredential?.credentialSubject} />
                    )}
                </dd>
            </div>
        );
    };

    const renderIssuerInfo = () => {
        const currentCredential = decryptedCredential || credential?.data;
        const isEncrypted = currentCredential?.issuer?.type === 'EncryptedData';
        return (
            <div className="px-4 py-6 sm:grid sm:grid-cols-4 sm:gap-4 sm:px-0">
                <dt className="text-sm font-medium leading-6 text-gray-900 sm:col-span-1">Issuer</dt>
                <dd className="mt-1 text-sm leading-6 text-gray-500 sm:col-span-3 sm:mt-0">
                    {isEncrypted ? (
                        <div className="ml-8 flex items-center text-gray-400">
                            <FontAwesomeIcon icon={faLock} className="mr-2" />
                            <span>Encrypted Data</span>
                        </div>
                    ) : (
                        <JsonDisplay data={currentCredential?.issuer} />
                    )}
                </dd>
            </div>
        );
    };

    useEffect(() => {
        setHelpComponent(
            <div className='space-y-4'>
                <p>This page displays the details of a specific digital credential.</p>
                <div>
                    <p className="mt-2"><strong>What can I do on this page?</strong></p>
                    <p>You can view the details of your credential, including its issuance date, issuer information, credential subject, and security signature. You can also decrypt the credential, share it, or delete it.</p>
                </div>
                <div>
                    <p className="mt-2"><strong>What do the buttons do?</strong></p>
                    <ul className="list-disc pl-5">
                        <li><strong>Share:</strong> Allows you to selectively share parts of your credential.</li>
                        <li><strong>Decrypt:</strong> Decrypts the credential to view its full contents.</li>
                        <li><strong>Delete:</strong> Permanently removes the credential from your wallet.</li>
                    </ul>
                </div>
                <div>
                    <p className="mt-2"><strong>What is the "View Credential Data" button?</strong></p>
                    <p>This button allows you to see the raw JSON data of your credential, which can be useful for technical verification or debugging purposes.</p>
                </div>
                <div>
                    <p className="mt-2"><strong>Why are some parts of my credential encrypted?</strong></p>
                    <p>Encryption ensures the privacy and security of your credential data. You can decrypt the credential to view its full contents when needed.</p>
                </div>
            </div>
        );

        return () => {
            setHelpComponent(null);
        };
    }, [setHelpComponent]);

    if (loading) {
        return <div className="text-center mt-8">Loading...</div>;
    }

    if (error) {
        return <div className="text-center mt-8 text-red-600">{error}</div>;
    }

    if (!credential) {
        return <div className="text-center mt-8">Credential not found</div>;
    }

    const handleShowCredentialData = () => {
        setModalData(decryptedCredential || credential.data);
        setShowModal(true);
    };

    return (
        <div className="container mx-auto px-0 sm:px-4">
            <div className="bg-white rounded-lg px-0 sm:px-6">
                <div className="flex items-center px-0 sm:px-4">
                    {credential.data.image && (
                        <div className="flex-shrink-0 mr-6 flex justify-center">
                            <Image input={credential.data.image} />
                        </div>
                    )}
                </div>
                <dl className="divide-y divide-gray-100">
                    <div className="px-4 py-6 sm:grid sm:grid-cols-4 sm:gap-4 sm:px-0">
                        <dt className="text-sm font-medium leading-6 text-gray-900 sm:col-span-1">Issuance Date</dt>
                        <dd className="mt-1 text-sm leading-6 ml-0 sm:ml-8 text-gray-500 sm:col-span-3 sm:mt-0">
                            {credential.data.issuanceDate ? new Date(credential.data.issuanceDate).toLocaleDateString() : 'Not available'}
                        </dd>
                    </div>
                    {renderIssuerInfo()}
                    {renderSubjectInfo()}
                    {renderProofInfo()}
                    <div className="px-4 py-6 sm:grid sm:grid-cols-4 sm:gap-4 sm:px-0">
                        <dt className="text-sm font-medium leading-6 text-gray-900 sm:col-span-1"></dt>
                        <dd className="mt-1 text-sm leading-6 ml-0 sm:ml-8 text-gray-500 sm:col-span-3 sm:mt-0">
                            <button
                                onClick={handleShowCredentialData}
                                className="text-sm font-medium text-indigo-600 hover:text-indigo-500 inline-flex items-center"
                            >
                                View Credential Data
                                <FontAwesomeIcon icon={faArrowRight} className="ml-2" />
                            </button>
                        </dd>
                    </div>
                </dl>
            </div>
            {showShareModal && credential && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-500 bg-opacity-75 flex items-center justify-center">
                    <ShareCredential
                        credential={decryptedCredential}
                        onShare={handleShare}
                        onCancel={() => setShowShareModal(false)}
                        className="w-full h-full sm:w-auto sm:h-auto sm:max-w-lg sm:mx-auto bg-white rounded-lg shadow-xl"
                    />
                </div>
            )}
            {showModal && (
                <Modal
                    isOpen={showModal}
                    onClose={() => setShowModal(false)}
                    jsonInput={modalData}
                    className="sm:w-full sm:h-full sm:m-0 md:w-4/5 md:h-[80vh] md:max-w-4xl md:my-8"
                />
            )}
        </div>
    );
};

export default CredentialDetails;
