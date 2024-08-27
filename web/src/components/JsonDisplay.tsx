import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faMinus } from '@fortawesome/free-solid-svg-icons';
import Image from './Image';

interface JsonDisplayProps {
  data: any;
}

const JsonDisplay: React.FC<JsonDisplayProps> = ({ data }) => {
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  const toggleExpand = (key: string) => {
    setExpandedKeys(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const camelToTitleCase = (str: string) => {
    return str
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  };

  const renderValue = (key: string, value: any, isArrayItem = false) => {
    const displayKey = camelToTitleCase(key);

    if (key === 'image' || key === 'portrait') {
      return (
        <div className="json-item flex items-start ml-6 px-2 py-1 hover:bg-gray-100 rounded-md overflow-hidden">
          <span className="json-key text-left font-semibold mr-2" style={{ fontSize: '0.8rem' }}>{isArrayItem ? `[${displayKey}]` : displayKey}</span>
          <span className="json-value flex-grow flex justify-end">
            <Image 
              input={value} 
              className="max-w-[64px] max-h-[64px] object-contain rounded-md"
            />
          </span>
        </div>
      );
    }

    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      const isExpanded = expandedKeys.includes(key);
      const isArray = Array.isArray(value);
      return (
        <div className={`json-item flex flex-col mb-1 ${isArray ? 'json-array' : 'json-object'}`}>
          <button onClick={() => toggleExpand(key)} className="json-expand-btn text-left font-semibold flex items-center w-full px-2 py-1 rounded hover:bg-gray-100">
            <div className="relative w-4 h-4 mr-2">
              <FontAwesomeIcon
                icon={faPlus}
                className={`text-gray-500 absolute inset-0 transition-all duration-300 ${
                  isExpanded ? 'opacity-0 rotate-90 scale-0' : 'opacity-100 rotate-0 scale-100'
                }`}
              />
              <FontAwesomeIcon
                icon={faMinus}
                className={`text-gray-500 absolute inset-0 transition-all duration-300 ${
                  isExpanded ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 rotate-90 scale-0'
                }`}
              />
            </div>
            <span style={{ fontSize: '0.8rem' }}>{isArrayItem ? `[${displayKey}]` : displayKey}</span>
          </button>
          <div className={`json-value overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-screen opacity-100' : 'max-h-0 opacity-0'}`}>
            <div className="ml-4 mt-1">
              {isArray ? (
                value.map((item: any, index: number) => (
                  <div key={index}>{renderValue(index.toString(), item, true)}</div>
                ))
              ) : (
                <JsonDisplay data={value} />
              )}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="json-item flex items-start ml-6 px-2 py-1 rounded hover:bg-gray-100">
        <span className="json-key text-left font-semibold mr-2" style={{ fontSize: '0.8rem' }}>{isArrayItem ? `[${displayKey}]` : displayKey}</span>
        <span className="json-value flex-grow flex justify-end">
          <span className="text-right" title={typeof value === 'string' ? value : JSON.stringify(value)}>
            {typeof value === 'string'
              ? trimValue(value)
              : trimValue(JSON.stringify(value))}
          </span>
        </span>
      </div>
    );
  };

  const trimValue = (value: string, maxLength: number = 32) => {
    return value.length > maxLength ? `${value.substring(0, maxLength)}...` : value;
  };

  return (
    <div className="json-display space-y-2">
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>{renderValue(key, value)}</div>
      ))}
    </div>
  );
};

export default JsonDisplay;
