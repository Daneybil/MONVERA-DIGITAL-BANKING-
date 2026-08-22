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
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
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
  );
};
