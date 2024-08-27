import React, { useEffect, useState } from 'react';
import { getCredentials, Credential } from '../services/db/credentials';
import { useUser } from '../contexts/UserContext';
import { Link } from 'react-router-dom';
import { useLayout } from '../contexts/LayoutContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus } from '@fortawesome/free-solid-svg-icons';

const CredentialList: React.FC = () => {
    const [credentials, setCredentials] = useState<Credential[]>([]);
    const { currentUser } = useUser();
    const { setTitle, setSubtitle, setCommandButtons, setHelpComponent } = useLayout();

    useEffect(() => {
        const fetchCredentials = async () => {
            if (currentUser) {
                const fetchedCredentials = await getCredentials(currentUser.id);
                setCredentials(fetchedCredentials);
            }
        };

        fetchCredentials();
    }, [currentUser]);

    useEffect(() => {
        setTitle('Your Credentials');
        setSubtitle('Manage your digital credentials');
        setHelpComponent((
            <div className='space-y-4'>
                <p>This page displays all your digital credentials.</p>
                <div>
                    <p className="mt-2"><strong>What can I do on this page?</strong></p>
                    <p>View details of each credential by clicking on it, create a new credential using the "Create New Credential" button, and observe different colors indicating different types of credentials.</p>
                </div>
                <div>
                    <p className="mt-2"><strong>What if I don't have any credentials?</strong></p>
                    <p>If you don't have any credentials yet, you'll see an option to create your first one.</p>
                </div>
                <div>
                    <p className="mt-2"><strong>How are credentials typically issued?</strong></p>
                    <p>In real-world scenarios, digital credentials are usually issued by authoritative entities like governments, educational institutions, or certified organizations. However, for the purpose of this demo, we're using self-issued credentials to showcase the functionality.</p>
                </div>
            </div>
        ));

        // Only set command buttons if there are credentials
        if (credentials.length > 0) {
            setCommandButtons([
                <Link
                    key="create-new-credential"
                    to="/credentials/new"
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                    <FontAwesomeIcon icon={faPlus} className="mr-2" />
                    Create New Credential
                </Link>
            ]);
        } else {
            setCommandButtons([]);
        }

        return () => {
            setCommandButtons([]);
            setHelpComponent(null);
        };
    }, [setTitle, setSubtitle, setCommandButtons, setHelpComponent, credentials.length]);

    const EmptyState = () => (
        <div className="flex flex-col items-center justify-center mt-[100px]">
            <div className="mb-4 p-4 rounded-full bg-gray-100">
                <FontAwesomeIcon icon={faPlus} className="text-4xl text-gray-400" />
            </div>
            <h2 className="text-2xl font-semibold mb-2">No credentials</h2>
            <p className="text-gray-500 mb-6">Get started by creating a new credential.</p>
            <Link
                to="/credentials/new"
                className="px-6 py-3 bg-indigo-600 text-white rounded-md font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
                + New Credential
            </Link>
        </div>
    );

    const getCardColor = (type: string[]): string => {
        const lowerCaseTypes = type.map(t => t.toLowerCase());

        if (lowerCaseTypes.includes('permanentresidentcard')) {
            return 'from-teal-500 to-teal-600';
        }

        if (lowerCaseTypes.includes('openbadgecredential')) {
            return 'from-purple-500 to-purple-600';
        }

        if (lowerCaseTypes.includes('iso18013driverslicensecredential')) {
            return 'from-blue-500 to-blue-600';
        }

        if (lowerCaseTypes.includes('employmentauthorizationdocumentcredential')) {
            return 'from-green-500 to-green-600';
        }

        if (lowerCaseTypes.includes('certificateofnaturalizationcredential')) {
            return 'from-yellow-500 to-yellow-600';
        }

        if (lowerCaseTypes.includes('clippedcouponcredential') || lowerCaseTypes.includes('gs18110couponcredential')) {
            return 'from-red-500 to-red-600';
        }

        if (lowerCaseTypes.includes('customerloyaltycredential')) {
            return 'from-indigo-500 to-indigo-600';
        }

        if (lowerCaseTypes.includes('movieticketcredential')) {
            return 'from-pink-500 to-pink-600';
        }

        if (lowerCaseTypes.includes('foodsafetycertificationcredential')) {
            return 'from-orange-500 to-orange-600';
        }

        return 'from-gray-500 to-gray-600';
    };

    return (
        <div className="container mx-auto px-4">
            {credentials.length === 0 ? (
                <EmptyState />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {credentials.map((credential) => (
                        <Link key={credential.id} to={`/credentials/${credential.id}`} className="block">
                            <div className={`bg-gradient-to-b ${getCardColor(credential.data.type)} rounded-xl p-6 shadow-lg hover:shadow-xl transition-shadow duration-300 text-white relative overflow-hidden`}>
                                <div className="absolute top-0 left-0 w-full h-16 bg-black bg-opacity-20 rounded-t-xl"></div>
                                <h2 className="text-2xl font-semibold mb-2 relative z-10">{credential.data.name || 'Unnamed Credential'}</h2>
                                <p className="text-opacity-90 text-white mb-4 relative z-10">{credential.data.description || 'No description available'}</p>
                                <div className="space-y-2 relative z-10">
                                    <p className="text-sm"><span className="font-medium">Type:</span> {credential.data.type.join(', ')}</p>
                                    <p className="text-sm"><span className="font-medium">Issuer:</span> {credential.data.issuer.name || 'Unknown'}</p>
                                    <p className="text-sm"><span className="font-medium">Issued:</span> {new Date(credential.data.issuanceDate).toLocaleDateString()}</p>
                                </div>
                                <div className="absolute bottom-0 right-0 w-24 h-24 bg-white bg-opacity-10 rounded-full -mr-12 -mb-12"></div>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
};

export default CredentialList;
