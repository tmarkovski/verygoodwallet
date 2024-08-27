import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInfoCircle, faExclamationTriangle, faCheckCircle, faTimesCircle } from '@fortawesome/free-solid-svg-icons';

export type MessageType = 'info' | 'warning' | 'success' | 'error';

interface MessageProps {
  type: MessageType;
  message: string;
  show: boolean;
}

const Message: React.FC<MessageProps> = ({ type, message, show }) => {
  const getMessageStyles = () => {
    switch (type) {
      case 'info':
        return 'bg-blue-100 text-blue-700 border-blue-500';
      case 'warning':
        return 'bg-yellow-100 text-yellow-700 border-yellow-500';
      case 'success':
        return 'bg-green-100 text-green-700 border-green-500';
      case 'error':
        return 'bg-red-100 text-red-700 border-red-500';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'info':
        return faInfoCircle;
      case 'warning':
        return faExclamationTriangle;
      case 'success':
        return faCheckCircle;
      case 'error':
        return faTimesCircle;
    }
  };

  return (
    <div
      className={`fixed mt-4 top-16 left-1/2 transform -translate-x-1/2 z-50 transition-all duration-300 ${
        show ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
      }`}
    >
      <div className={`flex items-center p-2 rounded-md border ${getMessageStyles()}`}>
        <FontAwesomeIcon icon={getIcon()} className="mr-2 text-sm" />
        <span className="text-sm">{message}</span>
      </div>
    </div>
  );
};

export default Message;
