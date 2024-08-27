
import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes } from '@fortawesome/free-solid-svg-icons';

interface UserDetailsModalProps {
  user: any;
  onClose: () => void;
}

const UserDetailsModal: React.FC<UserDetailsModalProps> = ({ user, onClose }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">User Details</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>
        <div>
          <p><strong>Name:</strong> {user.name}</p>
          <p><strong>Email:</strong> {user.email}</p>
          <p><strong>Last Seen:</strong> {user.lastSeen ? new Date(user.lastSeen).toLocaleString() : 'Unknown'}</p>
          <h3 className="font-semibold mt-4 mb-2">Credentials:</h3>
          <pre className="bg-gray-100 p-2 rounded">
            {JSON.stringify(user.credential, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
};

export default UserDetailsModal;