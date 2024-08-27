import React from 'react';

interface ImageProps {
  input: string | { id: string; type: string } | any;
  className?: string;
  style?: React.CSSProperties;
}

const Image: React.FC<ImageProps> = ({ input, className = '', style = {} }) => {
  const renderImage = () => {
    const baseClasses = "max-w-[64px] max-h-[64px] object-contain";
    const combinedClasses = `${baseClasses} ${className}`.trim();

    if (typeof input === 'string') {
      if (input.startsWith('data:image/png;base64,')) {
        return <img src={input} alt="Base64 encoded image" className={combinedClasses} style={style} />;
      } else if (input.startsWith('http')) {
        return <img src={input} alt="Image from URL" className={combinedClasses} style={style} />;
      }
    } else if (typeof input === 'object' && input.id && input.type === 'Image') {
      return <img src={input.id} alt="Image from URL" className={combinedClasses} style={style} />;
    }
    return <div>Invalid image input</div>;
  };

  return renderImage();
};

export default Image;
