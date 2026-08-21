import type { ColorValue, ViewProps } from 'react-native';

type Props = ViewProps & {
  color?: ColorValue;
};

export function SecureWebviewView(_props: Props): never {
  throw new Error(
    "'react-native-secure-webview' is only supported on native platforms."
  );
}
