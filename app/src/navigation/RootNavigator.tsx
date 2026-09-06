import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Dashboard from '../screens/Dashboard';
import Settings from '../screens/Settings';
import OnboardingScreen from '../screens/onboarding/OnboardingScreen';
import { PREF_KEYS, getPref } from '../services/storage';
import { useDevLinks } from '../services/devLinks';
import type { NavigationContainerRef } from '@react-navigation/native';

export type RootStackParamList = {
  Onboarding: undefined;
  Dashboard: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: '#0f271f', card: '#08110e', text: '#e8fff6', primary: '#22c55e', border: 'rgba(255,255,255,0.08)' },
};

export default function RootNavigator() {
  const [initial, setInitial] = useState<keyof RootStackParamList | null>(null);
  const navRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  useDevLinks({
    onboardingComplete: () => navRef.current?.reset({ index: 0, routes: [{ name: 'Dashboard' }] }),
    onboardingReset: () => navRef.current?.reset({ index: 0, routes: [{ name: 'Onboarding' }] }),
  });

  useEffect(() => {
    getPref(PREF_KEYS.onboardingComplete).then((v) => setInitial(v === '1' ? 'Dashboard' : 'Onboarding'));
  }, []);

  if (!initial) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0f271f', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#e8fff6" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navRef} theme={theme}>
      <Stack.Navigator initialRouteName={initial} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0f271f' } }}>
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        <Stack.Screen name="Dashboard" component={Dashboard} />
        <Stack.Screen name="Settings" component={Settings} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
