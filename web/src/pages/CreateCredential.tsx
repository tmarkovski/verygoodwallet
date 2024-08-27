import React, { useState, useEffect } from 'react';
import CredentialSelection, { ExampleCredential } from '../components/CredentialSelection';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import { useAuth } from '../services/auth';
import { encryptDocument, generateBbsKey, signDocument } from '../services/bbs';
import { addCredential } from '../services/db/credentials';
import { useLayout } from '../contexts/LayoutContext';
import Modal from '../components/Modal';
import { useLogging } from '../hooks/logging';

const CreateCredential: React.FC = () => {
    const { setTitle, setSubtitle, setMessage, setIsBusy } = useLayout();
    const [selectedCredential, setSelectedCredential] = useState<ExampleCredential | null>(null);
    const { currentUser } = useUser();
    const { login } = useAuth();
    const { logInfo, logError } = useLogging();
    const navigate = useNavigate();
    const [showModal, setShowModal] = useState(false);

    useEffect(() => {
        setTitle('Create New Credential');
        setSubtitle('');
    }, [setTitle, setSubtitle]);

    const handleCredentialSelect = (credential: ExampleCredential) => {
        setSelectedCredential(credential);
    };

    const handleCreateCredential = async () => {
        if (!selectedCredential) {
            setMessage({ text: 'No credential selected', type: 'error' });
            return;
        }

        if (!currentUser) {
            setMessage({ text: 'No user logged in', type: 'error' });
            return;
        }
        try {
            setIsBusy(true);
            const { masterKey } = await login(currentUser);
            if (masterKey) {

                const keyPair = await generateBbsKey(masterKey);
                const signedDocument = await signDocument(keyPair, selectedCredential.credential);
                const encryptedDocument = await encryptDocument(signedDocument, masterKey);
                const savedCredential = await addCredential({ data: encryptedDocument, userId: currentUser.id });
                // Set success message
                setMessage({ text: 'Credential created successfully!', type: 'success' });
                logInfo('Credential created', 'CreateCredential');
                // Navigate to the created credential page
                navigate(`/credentials/${savedCredential.id}`);

            } else {
                logError('Error creating credential: Could not find master key', new Error('No master key found'), 'CreateCredential');
                setMessage({ text: 'Error: Could not find master key. Please try again.', type: 'error' });
            }
        }
        catch (e) {
            console.error(e);
            logError('Error creating credential', e as Error, 'CreateCredential');
            setMessage({ text: 'Error creating credential or action cancelled.', type: 'error' });
        }
        finally {
            setIsBusy(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto p-4 pb-20 md:pb-4">
            <p className="text-gray-600 mb-6">Select the type of credential you want to create</p>
            <CredentialSelection onSelect={handleCredentialSelect} />
            {selectedCredential && (
                <div className="mt-16 flex flex-col items-center mb-16 md:mb-0">
                    <div className="hidden md:flex space-x-4">
                        <button
                            onClick={() => setShowModal(true)}
                            className="px-4 py-2 text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                        >
                            See Sample {selectedCredential.type}
                        </button>
                        <button
                            onClick={() => setTimeout(handleCreateCredential, 100)}
                            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                        >
                            Create {selectedCredential.type} Credential
                        </button>
                    </div>
                </div>
            )}
            {showModal && (
                <Modal
                    isOpen={showModal}
                    onClose={() => setShowModal(false)}
                    jsonInput={selectedCredential?.credential}
                />
            )}
            {selectedCredential && (
                <div className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-100 border-t border-gray-300 p-4 flex justify-center space-x-4">
                    <button
                        onClick={() => setShowModal(true)}
                        className="flex-1 px-4 py-2 text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                    >
                        See Sample
                    </button>
                    <button
                        onClick={() => setTimeout(handleCreateCredential, 100)}
                        className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                    >
                        Create {selectedCredential.type}
                    </button>
                </div>
            )}
        </div>
    );
};

export default CreateCredential;
