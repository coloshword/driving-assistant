import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RootNavigator from './src/navigation/RootNavigator';
import { installDevConsole } from './src/services/devConsole';

installDevConsole();

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#08110e" />
      <RootNavigator />
    </SafeAreaProvider>
  );
}
