import React, { useState, useEffect, useLayoutEffect } from "react";
import { useUser } from "../contexts/UserContext"; // Assume this exists
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCopy, faCheck, faTimes } from "@fortawesome/free-solid-svg-icons";
import { resolve } from "../services/bbs";
import Modal from "../components/Modal";
import { useLayout } from "../contexts/LayoutContext";

const Profile = () => {
  const { currentUser } = useUser();
  const [copied, setCopied] = useState(false);
  const [showDIDDocument, setShowDIDDocument] = useState(false);
  const [resolvedDocument, setResolvedDocument] = useState<any>(undefined);
  const { setTitle, setSubtitle } = useLayout();

  useLayoutEffect(() => {
    setTitle("User Profile");
    setSubtitle("Personal details and application.");

    return () => {
      setTitle("");
      setSubtitle("");
    };
  }, [setTitle, setSubtitle]);

  if (!currentUser) {
    return <div>Loading...</div>; // Or some other placeholder
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShowDIDDocument = async () => {
    const document = await resolve({ did: currentUser.controller! });
    setResolvedDocument(document);
    setShowDIDDocument(true);
  };

  const handleCloseModal = () => {
    setShowDIDDocument(false);
  };

  return (
    <>
        <dl className="divide-y divide-gray-100">
          <div className="px-4 py-6 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
            <dt className="text-sm font-medium leading-6 text-gray-900">Full name</dt>
            <dd className="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">{currentUser.name}</dd>
          </div>
          <div className="px-4 py-6 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
            <dt className="text-sm font-medium leading-6 text-gray-900">Last seen</dt>
            <dd className="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
              {new Date(currentUser.lastSeen).toLocaleString()}
            </dd>
          </div>
          <div className="px-4 py-6 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
            <dt className="text-sm font-medium leading-6 text-gray-900">Security extension</dt>
            <dd className="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
              {currentUser.supportedExtension}
              {currentUser.supportedExtension === "none" && (
                <span className="ml-2 text-xs text-gray-500">
                  <br />
                  (Your browser does not support any security extensions, but we will simulate one for demo purposes)
                </span>
              )}
            </dd>
          </div>
          <div className="px-4 py-6 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
            <dt className="text-sm font-medium leading-6 text-gray-900">Master key</dt>
            <dd className="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
              {currentUser.masterKeyCreated ? (
                <>
                  Created{" "}
                  <FontAwesomeIcon
                    icon={faCheck}
                    className="text-green-500"
                  />
                </>
              ) : (
                "Not yet created"
              )}
            </dd>
          </div>
          <div className="px-4 py-6 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
            <dt className="text-sm font-medium leading-6 text-gray-900">
              Controller
              <p className="mt-1 font-normal text-gray-500">
                The controller is a unique identifier for your decentralized identity. It resolves to a{" "}
                <button onClick={handleShowDIDDocument} className="text-indigo-600 hover:text-indigo-500 font-medium">
                  DID document
                </button>
                .
              </p>
            </dt>
            <dd className="mt-1 text-sm leading-6 text-gray-700 sm:col-span-2 sm:mt-0">
              {currentUser.controller ? (
                <div>
                  <div className="flex items-center">
                    <span className="rounded overflow-hidden">
                      {currentUser.controller.slice(0, 64)}
                      {currentUser.controller.length > 64 && "..."}
                    </span>
                    <button
                      onClick={() => copyToClipboard(currentUser?.controller || "")}
                      className="ml-2 text-indigo-600 hover:text-indigo-500"
                      title="Copy to clipboard"
                    >
                      <FontAwesomeIcon icon={faCopy} />
                    </button>
                    {copied && <span className="ml-2 text-sm text-green-500">Copied!</span>}
                  </div>
                </div>
              ) : (
                "Not yet created"
              )}
            </dd>
          </div>
        </dl>
      {showDIDDocument && <Modal isOpen={showDIDDocument} onClose={handleCloseModal} jsonInput={resolvedDocument} />}
    </>
  );
};

export default Profile;
