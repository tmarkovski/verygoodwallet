import { useCallback } from 'react';
import ReactGA from 'react-ga4';

export const useLogging = () => {
  const logEvent = useCallback((level: string, message: string, error?: Error, context?: string) => {
    console[level as 'log' | 'info' | 'warn' | 'error'](`[${level.toUpperCase()}] ${context ? `${context}: ` : ''}${message}`, error || '');

    ReactGA.event({
      category: 'Logging',
      action: `${level.charAt(0).toUpperCase() + level.slice(1)} - ${context || 'General'}`,
      label: error ? `${error.name}: ${error.message}` : message,
      nonInteraction: true
    });
  }, []);

  const logError = useCallback((message: string, error: Error, context?: string) => {
    logEvent('error', message, error, context);
  }, [logEvent]);

  const logInfo = useCallback((message: string, context?: string) => {
    logEvent('info', message, undefined, context);
  }, [logEvent]);

  const logWarning = useCallback((message: string, context?: string) => {
    logEvent('warn', message, undefined, context);
  }, [logEvent]);

  const logDebug = useCallback((message: string, context?: string) => {
    logEvent('debug', message, undefined, context);
  }, [logEvent]);

  const withErrorLogging = useCallback(<T extends (...args: any[]) => any>(
    fn: T,
    context?: string
  ) => {
    return (...args: Parameters<T>): ReturnType<T> | void => {
      try {
        return fn(...args);
      } catch (error) {
        logError('An error occurred', error as Error, context);
      }
    };
  }, [logError]);

  return { logError, logInfo, logWarning, logDebug, withErrorLogging };
};