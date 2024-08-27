import React, { createContext, useState, useContext, ReactNode } from 'react';
import { MessageType } from '../components/Message';

interface MessageState {
  text: string;
  type: MessageType;
}

interface LayoutContextType {
  title: string;
  setTitle: (title: string) => void;
  subtitle: string;
  setSubtitle: (subtitle: string) => void;
  commandButtons: React.ReactNode[];
  setCommandButtons: (buttons: React.ReactNode[]) => void;
  isHeaderVisible: boolean;
  setHeaderVisible: (isVisible: boolean) => void;
  message: MessageState;
  setMessage: (message: MessageState) => void;
  isBusy: boolean;
  setIsBusy: (isBusy: boolean) => void;
  helpComponent: React.ReactNode | null;
  setHelpComponent: (component: React.ReactNode | null) => void;
}

const LayoutContext = createContext<LayoutContextType | undefined>(undefined);

export const LayoutProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [commandButtons, setCommandButtons] = useState<React.ReactNode[]>([]);
  const [isHeaderVisible, setHeaderVisible] = useState(true);
  const [message, setMessage] = useState<MessageState>({ text: '', type: 'info' });
  const [isBusy, setIsBusy] = useState(false);
  const [helpComponent, setHelpComponent] = useState<React.ReactNode | null>(null);

  return (
    <LayoutContext.Provider value={{
      title,
      setTitle,
      subtitle,
      setSubtitle,
      commandButtons,
      setCommandButtons,
      isHeaderVisible,
      setHeaderVisible,
      message,
      setMessage,
      isBusy,
      setIsBusy,
      helpComponent,
      setHelpComponent,
    }}>
      {children}
    </LayoutContext.Provider>
  );
};

export const useLayout = () => {
  const context = useContext(LayoutContext);
  if (context === undefined) {
    throw new Error('useLayout must be used within a LayoutProvider');
  }
  return context;
};