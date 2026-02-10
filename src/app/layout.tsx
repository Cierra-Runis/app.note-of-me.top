import { AppSidebar } from '@/components/sidebar';
import { ThemeProvider } from '@/components/theme-provider';
import { Separator } from '@/components/ui/separator';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'アプリ of 我',
  icons: 'https://avatars.githubusercontent.com/u/29329988',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='en' suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased text-foreground bg-background`}
      >
        <ThemeProvider
          attribute='class'
          defaultTheme='system'
          enableSystem
          disableTransitionOnChange
        >
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <header className='bg-background sticky top-0 flex h-14 shrink-0 items-center gap-2'>
                <div className='flex items-center gap-2 px-4'>
                  <SidebarTrigger className='-ml-1' />
                  <Separator
                    orientation='vertical'
                    className='mr-2 data-[orientation=vertical]:h-4'
                  />
                </div>
              </header>
              {children}
            </SidebarInset>
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
