import React, { useEffect, useState } from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';

import { imageResourceIdentity } from './imageResourceIdentity';

interface StableRemoteImageProps {
  uri: string;
  style?: StyleProp<ImageStyle>;
}

/** Keeps loaded pixels mounted when only a short-lived URL grant rotates. */
export function StableRemoteImage({ uri, style }: StableRemoteImageProps) {
  const resourceIdentity = imageResourceIdentity(uri);
  const [source, setSource] = useState(uri);

  useEffect(() => {
    setSource(uri);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceIdentity]);

  return <Image source={{ uri: source }} style={style} />;
}
