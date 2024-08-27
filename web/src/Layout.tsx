import { Link, Outlet, useNavigate, useLocation } from "react-router-dom";
import { Disclosure, Menu, Transition } from "@headlessui/react";
import { Fragment, useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faBars, faTimes, faQuestionCircle } from "@fortawesome/free-solid-svg-icons";
import { useUser } from "./contexts/UserContext";
import { useLayout } from "./contexts/LayoutContext";
import Message from "./components/Message";
import { ReactComponent as WalletIconSVG } from "./assets/wallet.svg";

/** @jsxImportSource @emotion/react */
import { css, keyframes } from "@emotion/react";

const jumpKeyframes = keyframes`
0%, 20%, 50%, 80%, 100% {
  transform: translateY(0);
}
40% {
  transform: translateY(-20px);
}
60% {
  transform: translateY(-10px);
}
`;

const rainbowKeyframes = keyframes`
  0% { filter: hue-rotate(0deg); }
  100% { filter: hue-rotate(360deg); }
`;

function classNames(...classes: string[]) {
  return classes.filter(Boolean).join(" ");
}

const Layout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser, logout } = useUser();
  const { title, subtitle, commandButtons, isHeaderVisible, message, setMessage, isBusy, setIsBusy, helpComponent } =
    useLayout();
  const [showMessage, setShowMessage] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  useEffect(() => {
    if (message.text) {
      setShowMessage(true);
      const fadeOutTimer = setTimeout(() => {
        setShowMessage(false);
      }, 3000);
      const clearMessageTimer = setTimeout(() => {
        setMessage({ text: "", type: "info" });
      }, 3300); // Add 300ms to allow for fade out animation
      return () => {
        clearTimeout(fadeOutTimer);
        clearTimeout(clearMessageTimer);
      };
    }
  }, [message, setMessage]);

  // Add this new function to determine if a nav item is current
  const isCurrentPage = (href: string) => location.pathname === href;

  const getUserInitials = (name: string) => {
    const names = name.split(" ");
    if (names.length > 1) {
      return `${names[0][0]}${names[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const getColorFromName = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 80%)`;
  };

  const handleLogout = () => {
    setIsBusy(true);
    setTimeout(() => {
      if (window.confirm("Are you sure you want to sign out?")) {
        logout();
      }
      setIsBusy(false);
    }, 100);
  };

  const handleProfileClick = () => {
    navigate("/profile");
  };

  const toggleHelp = () => {
    setIsHelpOpen(!isHelpOpen);
  };

  return (
    <div className="font-sans min-h-screen flex flex-col">
      <Disclosure as="nav" className="bg-gray-800">
        {({ open }) => (
          <>
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="flex h-16 items-center justify-between">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <WalletIconSVG
                      className="h-10 w-10 text-orange-500"
                      css={css`
                        animation: ${rainbowKeyframes} 120s linear infinite;
                        ${isBusy &&
                        css`
                          animation: ${rainbowKeyframes} 120s linear infinite, ${jumpKeyframes} 1.2s ease infinite;
                        `}
                      `}
                    />
                  </div>
                  <div className="hidden md:block">
                    <div className="ml-10 flex items-baseline space-x-4">
                      {currentUser && (
                        // add link to credentials page
                        <>
                          <Link
                            key="credentials"
                            to="/credentials"
                            className={classNames(
                              isCurrentPage("/credentials")
                                ? "bg-gray-900 text-white"
                                : "text-gray-300 hover:bg-gray-700 hover:text-white",
                              "rounded-md px-3 py-2 text-sm font-medium"
                            )}
                            aria-current={isCurrentPage("/credentials") ? "page" : undefined}
                          >
                            My Wallet
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="hidden md:block">
                  {currentUser && (
                    <div className="flex items-center z-20">
                      <Menu as="div" className="relative ml-3">
                        {({ open }) => (
                          <>
                            <div>
                              <Menu.Button className="flex items-center rounded-full bg-gray-800 text-sm focus:outline-none">
                                <span className="text-white mr-3">{currentUser.name}</span>
                                <span className="sr-only">Open user menu</span>
                                <div
                                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-gray-600"
                                  style={{ backgroundColor: getColorFromName(currentUser.name) }}
                                >
                                  {getUserInitials(currentUser.name)}
                                </div>
                                <FontAwesomeIcon
                                  icon={faChevronDown}
                                  className="ml-2 h-4 w-4 text-gray-400"
                                  aria-hidden="true"
                                />
                              </Menu.Button>
                            </div>
                            <Transition
                              show={open}
                              as={Fragment}
                              enter="transition ease-out duration-100"
                              enterFrom="transform opacity-0 scale-95"
                              enterTo="transform opacity-100 scale-100"
                              leave="transition ease-in duration-75"
                              leaveFrom="transform opacity-100 scale-100"
                              leaveTo="transform opacity-0 scale-95"
                            >
                              <Menu.Items
                                static
                                className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none"
                              >
                                <Menu.Item>
                                  {({ active }) => (
                                    <button
                                      onClick={handleProfileClick}
                                      className={classNames(
                                        active ? "bg-gray-100" : "",
                                        "block w-full text-left px-4 py-2 text-sm text-gray-700"
                                      )}
                                    >
                                      Your Profile
                                    </button>
                                  )}
                                </Menu.Item>
                                <Menu.Item>
                                  {({ active }) => (
                                    <button
                                      onClick={handleLogout}
                                      className={classNames(
                                        active ? "bg-gray-100" : "",
                                        "block w-full text-left px-4 py-2 text-sm text-gray-700"
                                      )}
                                    >
                                      Sign out
                                    </button>
                                  )}
                                </Menu.Item>
                              </Menu.Items>
                            </Transition>
                          </>
                        )}
                      </Menu>
                    </div>
                  )}
                </div>
                <div className="-mr-2 flex md:hidden">
                  {/* Mobile menu button */}
                  <Disclosure.Button className="inline-flex items-center justify-center rounded-md bg-gray-800 p-2 text-gray-400 hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-gray-800">
                    <span className="sr-only">Open main menu</span>
                    <FontAwesomeIcon icon={open ? faTimes : faBars} className="block h-6 w-6" aria-hidden="true" />
                  </Disclosure.Button>
                </div>
              </div>
            </div>

            <Disclosure.Panel className="md:hidden">
              <div className="space-y-1 px-2 pb-3 pt-2 sm:px-3">
                {currentUser && (
                  <Disclosure.Button
                    key="credentials"
                    as={Link}
                    to="/credentials"
                    className={classNames(
                      isCurrentPage("/credentials")
                        ? "bg-gray-900 text-white"
                        : "text-gray-300 hover:bg-gray-700 hover:text-white",
                      "block rounded-md px-3 py-2 text-base font-medium"
                    )}
                    aria-current={isCurrentPage("/credentials") ? "page" : undefined}
                  >
                    My Wallet
                  </Disclosure.Button>
                )}
              </div>
              {currentUser && (
                <div className="border-t border-gray-700 pb-3 pt-4">
                  <div className="flex items-center px-5">
                    <div className="flex-shrink-0">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-gray-600"
                        style={{ backgroundColor: getColorFromName(currentUser.name) }}
                      >
                        {getUserInitials(currentUser.name)}
                      </div>
                    </div>
                    <div className="ml-3">
                      <div className="text-base font-medium leading-none text-white">{currentUser.name}</div>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1 px-2">
                    <Disclosure.Button
                      as={Link}
                      to="/profile"
                      className="block w-full text-left rounded-md px-3 py-2 text-base font-medium text-gray-400 hover:bg-gray-700 hover:text-white"
                    >
                      Your Profile
                    </Disclosure.Button>
                    <Disclosure.Button
                      as="button"
                      onClick={handleLogout}
                      className="block w-full text-left rounded-md px-3 py-2 text-base font-medium text-gray-400 hover:bg-gray-700 hover:text-white"
                    >
                      Sign out
                    </Disclosure.Button>
                  </div>
                </div>
              )}
            </Disclosure.Panel>
          </>
        )}
      </Disclosure>

      {isHeaderVisible && (
        <header className="bg-white shadow">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
                {subtitle && <p className="mt-2 text-sm text-gray-600">{subtitle}</p>}
              </div>
              {commandButtons && <div className="flex space-x-2">{commandButtons}</div>}
            </div>
          </div>
        </header>
      )}

      <div className="relative z-50">
        {" "}
        {/* Updated this line */}
        <Message type={message.type} message={message.text} show={showMessage} />
      </div>

      <main className="flex-grow flex">
        <div className="mx-auto max-w-7xl px-0 md:px-4 py-6 lg:px-8 flex-grow flex">
          <div className="flex-grow">
            <Outlet />
          </div>
          {helpComponent && (
            <>
              <button
                onClick={toggleHelp}
                className="fixed right-0 bottom-8 px-3 py-2 bg-gray-600 text-white rounded-l-full cursor-pointer z-50 flex items-center justify-center shadow-xl hover:bg-gray-700 transition-colors duration-200"
              >
                <FontAwesomeIcon icon={faQuestionCircle} className="mr-2" />
                Help & Hints
              </button>
              <div
                className={`
                  bg-gray-100 p-5 shadow-lg overflow-y-auto
                  fixed top-0 bottom-0 right-0 w-80 sm:w-96
                  transition-transform duration-300 ease-in-out
                  ${isHelpOpen ? "translate-x-0" : "translate-x-full"}
                  z-40
                  border-l border-gray-200
                `}
              >
                <h2 className="text-xl font-semibold mb-4">Help & Hints</h2>
                <div className="text-sm">{helpComponent}</div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default Layout;
