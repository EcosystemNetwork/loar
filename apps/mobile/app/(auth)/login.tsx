/**
 * Login screen — Circle DCW (email OTP + native Google).
 *
 * Flow:
 *   1. User enters email → server sends 6-digit code (`/auth/circle/register`)
 *   2. User enters code → server verifies, provisions Circle wallet, returns JWT
 *      (`/auth/circle/verify-otp`)
 *   3. (Optional) User taps "Continue with Google" → expo-auth-session opens
 *      the native Google flow, returns an ID token → server verifies it and
 *      returns JWT (`/auth/circle/social`)
 *
 * The Circle wallet is server-managed — all contract writes route through
 * `/api/tx/write` server-side, so no private keys ever touch the device.
 */
import * as Google from 'expo-auth-session/providers/google';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/ui/Button';
import { useAuth } from '../../src/contexts/AuthContext';

// expo-auth-session uses expo-web-browser under the hood; this call
// dismisses any lingering auth popup when the app resumes.
WebBrowser.maybeCompleteAuthSession();

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

const GOOGLE_ENABLED = Boolean(
  GOOGLE_WEB_CLIENT_ID || GOOGLE_IOS_CLIENT_ID || GOOGLE_ANDROID_CLIENT_ID
);

export default function LoginScreen() {
  const router = useRouter();
  const {
    isAuthenticated,
    isAuthenticating,
    error,
    clearError,
    requestEmailOTP,
    signInWithEmail,
    signInWithGoogle,
  } = useAuth();

  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // ── Google (only active when a client ID is configured) ────────────────
  const [googleRequest, googleResponse, promptGoogle] = Google.useAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
  });

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    const message = error || localError;
    if (message) {
      Alert.alert('Sign-in failed', message, [
        {
          text: 'OK',
          onPress: () => {
            clearError();
            setLocalError(null);
          },
        },
      ]);
    }
  }, [error, localError, clearError]);

  useEffect(() => {
    if (googleResponse?.type !== 'success') return;
    const idToken = googleResponse.authentication?.idToken;
    if (!idToken) {
      setLocalError('Google returned no ID token');
      return;
    }
    signInWithGoogle(idToken).catch(() => undefined);
  }, [googleResponse, signInWithGoogle]);

  const handleSendOTP = async () => {
    setLocalError(null);
    setIsSending(true);
    try {
      const result = await requestEmailOTP(email);
      setStep('otp');
      if (result._devOtp) {
        // Dev mode: pre-fill so the flow is one-tap in local testing.
        setCode(result._devOtp);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to send code');
    } finally {
      setIsSending(false);
    }
  };

  const handleVerifyOTP = async () => {
    setLocalError(null);
    try {
      await signInWithEmail(email, code);
    } catch {
      // Error is surfaced through AuthContext.error
    }
  };

  const handleGoogle = async () => {
    setLocalError(null);
    try {
      await promptGoogle();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Google sign-in failed');
    }
  };

  const loading = isSending || isAuthenticating;
  const canContinueEmail = email.includes('@') && email.length <= 255;
  const canSubmitOtp = code.length >= 6 && !isAuthenticating;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-1 px-6 pt-16 pb-8 gap-8">
            {/* Brand */}
            <View className="items-center gap-4 pt-8">
              <View className="w-20 h-20 rounded-2xl bg-primary items-center justify-center">
                <Text className="text-4xl">⬡</Text>
              </View>
              <View className="items-center gap-2">
                <Text className="text-text-primary text-3xl font-bold">LOAR Vault</Text>
                <Text className="text-text-secondary text-base text-center">
                  Sign in to manage your universes, collectibles, and earnings
                </Text>
              </View>
            </View>

            <View className="flex-1" />

            {/* Form */}
            <View className="gap-4">
              {step === 'email' ? (
                <>
                  <Text className="text-text-secondary text-sm">Email</Text>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    placeholderTextColor="#52525b"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    keyboardType="email-address"
                    inputMode="email"
                    returnKeyType="next"
                    editable={!loading}
                    onSubmitEditing={() => canContinueEmail && handleSendOTP()}
                    className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-text-primary text-base"
                  />
                  <Button
                    onPress={handleSendOTP}
                    loading={loading}
                    disabled={!canContinueEmail}
                    fullWidth
                    size="lg"
                  >
                    Continue with Email
                  </Button>

                  {GOOGLE_ENABLED ? (
                    <>
                      <View className="flex-row items-center gap-3 py-2">
                        <View className="flex-1 h-px bg-zinc-800" />
                        <Text className="text-text-tertiary text-[10px] uppercase tracking-widest">
                          or
                        </Text>
                        <View className="flex-1 h-px bg-zinc-800" />
                      </View>
                      <Button
                        onPress={handleGoogle}
                        loading={loading}
                        disabled={!googleRequest}
                        fullWidth
                        size="lg"
                        variant="secondary"
                      >
                        Continue with Google
                      </Button>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <Text className="text-text-secondary text-sm">
                    Enter the 6-digit code we sent to{'\n'}
                    <Text className="text-text-primary font-semibold">{email}</Text>
                  </Text>
                  <TextInput
                    value={code}
                    onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    placeholderTextColor="#52525b"
                    keyboardType="number-pad"
                    inputMode="numeric"
                    maxLength={6}
                    autoFocus
                    editable={!loading}
                    onSubmitEditing={() => canSubmitOtp && handleVerifyOTP()}
                    className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-text-primary text-2xl font-mono tracking-[0.4em] text-center"
                  />
                  <Button
                    onPress={handleVerifyOTP}
                    loading={isAuthenticating}
                    disabled={!canSubmitOtp}
                    fullWidth
                    size="lg"
                  >
                    Verify & Sign In
                  </Button>
                  <Button
                    onPress={() => {
                      setStep('email');
                      setCode('');
                      clearError();
                    }}
                    disabled={loading}
                    fullWidth
                    variant="secondary"
                  >
                    Use a different email
                  </Button>
                </>
              )}

              <Text className="text-text-tertiary text-xs text-center">
                Secured by Circle. Your wallet is server-managed — no seed phrase to lose.
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
