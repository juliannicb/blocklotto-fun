// src/pages/_app.tsx
import type { AppProps } from 'next/app';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '@/lib/wagmi';
import '@/styles/globals.css';
import { Space_Grotesk } from 'next/font/google';

const queryClient = new QueryClient();

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['300','400','500','600','700'],
  display: 'swap',
});

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <div className={spaceGrotesk.className}>
          <Component {...pageProps} />
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
