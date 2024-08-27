import React, { useState } from 'react';

interface ShareCredentialProps {
  credential: any;
  onShare: (selectedFields: string[]) => void;
  onCancel: () => void;
  className?: string; // Add this line
}

export default function ShareCredential({ credential, onShare, onCancel, className }: ShareCredentialProps) {
  const [selectedFields, setSelectedFields] = useState<string[]>([]);

  const toggleField = (field: string) => {
    setSelectedFields(prev =>
      prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]
    );
  };

  const toggleAll = () => {
    const toggleableFields = Object.keys(credential.credentialSubject).filter(field => !isIdOrType(field));
    setSelectedFields(prev => 
      prev.length === toggleableFields.length 
        ? Object.keys(credential.credentialSubject).filter(isIdOrType) 
        : toggleableFields
    );
  };

  const handleShare = () => {
    const jsonPointers = selectedFields.map(field => `/credentialSubject/${field}`);
    onShare(jsonPointers);
  };

  const shareableFields = Object.keys(credential.credentialSubject);
  const showSelectAllButton = shareableFields.length > 5;

  // Add this function to check if a field is 'id' or 'type'
  const isIdOrType = (field: string) => field === 'id' || field === 'type';

  // New function to check if sharing is allowed
  const isSharingAllowed = () => {
    return selectedFields.length > 0 || shareableFields.some(isIdOrType);
  };

  return (
    <div className={`${className} flex flex-col h-full`}>
      <div className="flex-grow overflow-auto p-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Share Credential</h3>
          <button
            onClick={onCancel}
            className="sm:hidden text-gray-400 hover:text-gray-600"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">Select the fields you want to share:</p>
        {showSelectAllButton && (
          <div className="flex justify-start items-center mb-2">
            <button
              onClick={toggleAll}
              className="px-2 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              {selectedFields.length === shareableFields.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>
        )}
        <div className="space-y-2">
          {shareableFields.map((field) => (
            <div key={field} className="flex items-center">
              <input
                type="checkbox"
                id={field}
                checked={selectedFields.includes(field) || isIdOrType(field)}
                onChange={() => toggleField(field)}
                disabled={isIdOrType(field)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor={field} className="ml-2 block text-sm text-gray-900">
                {field}
              </label>
            </div>
          ))}
        </div>
      </div>
      <div className="p-4 bg-gray-50 sm:bg-transparent">
        <div className="flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            onClick={handleShare}
            disabled={!isSharingAllowed()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-blue-300"
          >
            Share
          </button>
        </div>
      </div>
    </div>
  );
}
