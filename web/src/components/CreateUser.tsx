import React, { useState } from "react";
import { addUser, SecurityExtension, User } from "../services/db/users";
import { useAuth } from "../services/auth";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUserPlus } from "@fortawesome/free-solid-svg-icons";
import { useLogging } from "../hooks/logging";

const findSupportedExtension = (extensionResults: any): SecurityExtension => {
  if (
    extensionResults.largeBlob &&
    extensionResults.largeBlob.supported === true
  ) {
    return SecurityExtension.LARGEBLOB;
  }

  if (extensionResults.prf && extensionResults.prf.enabled === true) {
    return SecurityExtension.PRF;
  }

  return SecurityExtension.NONE;
};

const CreateUser = ({
  onFocusChange,
  onCreateUser,
}: {
  onFocusChange: (focused: boolean) => void;
  onCreateUser: (user: User) => void;
}) => {
  const [name, setName] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isFocused, setIsFocused] = useState(false);
  const { register } = useAuth();
  const { logError } = useLogging();

  const handleCreateUser = async () => {
    try {
      // Register new passkey and get the credential and extensions
      const { credential, extensions } = await register(name);
      // Create a new database entry for the user
      const supportedExtension = findSupportedExtension(extensions);
      const user = await addUser({
        name,
        credentialId: credential.rawId,
        masterKeyCreated: supportedExtension === SecurityExtension.PRF,
        simulatedMasterKey:
          supportedExtension === SecurityExtension.NONE
            ? crypto.getRandomValues(new Uint8Array(32))
            : undefined,
        supportedExtension,
      });
      onCreateUser(user);
    } catch (error) {
      logError("Error creating user", error as Error, "CreateUser");
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    onFocusChange(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
    onFocusChange(false);
  };

  return (
    <div className={`text-left rounded-2xl`}>
      <h1 className="text-xl font-bold text-gray-100 mb-2">
        Create new account
      </h1>
      <p className="text-gray-300 mb-6">
        Enter your name to create new account and register a passkey.
      </p>
      <div className="h-6" />
      <div className="space-y-6">
        <input
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className="w-full p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-500 focus:border-fuchsia-500 bg-gray-800 bg-opacity-50 text-gray-100 placeholder-gray-400 border border-white border-opacity-20"
        />
        <div className="flex justify-end">
          <button
            onClick={handleCreateUser}
            disabled={!name}
            className={`px-4 py-2 rounded-full focus:outline-none focus:ring-2 focus:ring-fuchsia-500 focus:ring-opacity-50 flex items-center ${
              name
                ? "bg-fuchsia-500 text-white hover:bg-fuchsia-600 transition-colors duration-200"
                : "bg-gray-500 text-gray-300 cursor-not-allowed opacity-50"
            }`}
          >
            <FontAwesomeIcon icon={faUserPlus} className="mr-2" />
            Register with Passkey
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateUser;
