import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RootNavigator from './src/navigation/RootNavigator';
import { installDevConsole } from './src/services/devConsole';
import Config from 'react-native-config';
import { apiBaseUrl } from './src/services/agent/api';

installDevConsole();
// DIAG startup: report what URL the app resolves
console.log('DIAG Config.API_BASE_URL =', JSON.stringify(Config?.API_BASE_URL));
apiBaseUrl().then((u) => console.log('DIAG resolved apiBaseUrl =', u)).catch((e) => console.log('DIAG apiBaseUrl err', String(e)));

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#08110e" />
      <RootNavigator />
    </SafeAreaProvider>
  );
}
