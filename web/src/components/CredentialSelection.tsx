import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faIdCard, faPassport, faCar, faGraduationCap, faTicketAlt } from '@fortawesome/free-solid-svg-icons';
import idCard from '../credentials/prc/credential.json';
import passport from '../credentials/utopia-natcert/credential.json';
import driverLicense from '../credentials/utopia-dl/credential.json';
import diploma from '../credentials/academic-course-credential/credential.json';
import retailCouponCredential from '../credentials/retail-coupon/credential.json';

export interface ExampleCredential {
  type: string;
  icon: any;
  description: string;
  credential: any;
}

const credentials: ExampleCredential[] = [
  { 
    type: 'ID Card', 
    icon: faIdCard, 
    description: 'Government-issued identification card',
    credential: idCard
  },
  { 
    type: 'Passport', 
    icon: faPassport, 
    description: 'International travel document',
    credential: passport
  },
  { 
    type: 'Driver License', 
    icon: faCar, 
    description: 'Permit to operate a motor vehicle',
    credential: driverLicense
  },
  { 
    type: 'Diploma', 
    icon: faGraduationCap, 
    description: 'Academic degree or qualification',
    credential: diploma
  },
  {
    type: 'Retail Coupon',
    description: 'Digital coupon for retail discounts',
    icon: faTicketAlt,
    credential: retailCouponCredential,
  },
];

interface CredentialSelectionProps {
  onSelect: (credential: ExampleCredential) => any;
}

const CredentialSelection: React.FC<CredentialSelectionProps> = ({ onSelect }) => {
  const [selectedCredential, setSelectedCredential] = React.useState<ExampleCredential | null>(null);

  const handleSelect = (credential: ExampleCredential) => {
    setSelectedCredential(credential);
    onSelect(credential);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {credentials.map((credential) => (
        <button
          key={credential.type}
          onClick={() => handleSelect(credential)}
          className={`flex flex-col items-center p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 border-2 ${
            selectedCredential?.type === credential.type
              ? 'bg-purple-100 border-indigo-500'
              : 'bg-white border-transparent hover:border-indigo-500'
          }`}
        >
          <FontAwesomeIcon icon={credential.icon} className="text-4xl text-indigo-600 mb-2" />
          <h3 className="text-lg font-semibold text-gray-800">{credential.type}</h3>
          <p className="text-sm text-gray-600 text-center mt-2">{credential.description}</p>
        </button>
      ))}
    </div>
  );
};

export default CredentialSelection;