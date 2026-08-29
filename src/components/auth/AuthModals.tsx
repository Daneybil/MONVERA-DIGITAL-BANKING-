import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { LoginPage } from './LoginPage';
import { SignUpPage } from './SignUpPage';

export const AuthModals: React.FC = () => {
  const { activeModal, closeModal, openModal } = useAuth();

  if (!activeModal || (activeModal !== 'auth_login' && activeModal !== 'auth_register' && activeModal !== 'auth_prompt')) {
    return null;
  }

  return (
    <div
      id="monvera-auth-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div
        className="w-full max-w-[500px] max-h-[96vh] overflow-y-auto relative my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {activeModal === 'auth_login' || activeModal === 'auth_prompt' ? (
          <LoginPage
            isModal={true}
            onClose={closeModal}
            onSwitchToSignUp={() => openModal('auth_register')}
          />
        ) : (
          <SignUpPage
            isModal={true}
            onClose={closeModal}
            onSwitchToLogin={() => openModal('auth_login')}
          />
        )}
      </div>
    </div>
  );
};
