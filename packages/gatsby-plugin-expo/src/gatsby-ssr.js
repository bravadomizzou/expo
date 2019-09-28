import withExpoRoot from 'expo/build/launch/withExpoRoot';
import * as React from 'react';
import { renderToString } from 'react-dom/server';

import { AppRegistry } from 'react-native';

function replaceRenderer({ bodyComponent, replaceBodyHTMLString, setHeadComponents }) {
  const App = withExpoRoot(() => bodyComponent);

  const RootComponent = props => <App exp={{}} {...props} />;

  AppRegistry.registerComponent('main', () => RootComponent);
  const { element, getStyleElement } = AppRegistry.getApplication('main');

  const markup = renderToString(element);
  const styleElement = getStyleElement();

  replaceBodyHTMLString(markup);
  // TODO: Bacon: Get Expo PWA head elements
  setHeadComponents([styleElement]);
}

exports.replaceRenderer = replaceRenderer;
