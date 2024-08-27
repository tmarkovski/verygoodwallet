import React, { useState, useEffect } from 'react';
import Editor, { DiffEditor, useMonaco, loader } from '@monaco-editor/react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  jsonInput: any;
  className?: string;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, jsonInput, className }) => {
  const [editorValue, setEditorValue] = useState(jsonInput);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
    } else {
      setTimeout(() => setIsVisible(false), 300); // Delay hiding to allow animation
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className={`bg-white p-4 rounded-lg w-full h-full max-h-screen overflow-hidden flex flex-col ${className}`}>
        <div className="flex-grow overflow-auto">
          <Editor
            height="100%"
            defaultLanguage="json"
            defaultValue={JSON.stringify(editorValue, null, 2)}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              lineNumbers: 'off',
              wordWrap: 'on',
              scrollbar: {
                vertical: 'visible',
                horizontal: 'hidden'
              }
            }}
          />
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default Modal;
