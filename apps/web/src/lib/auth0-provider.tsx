"use client"

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { createAuth0Client, Auth0Client } from '@auth0/auth0-spa-js'
import { mixpanel } from './mixpanel'

interface Auth0User {
    email?: string
    email_verified?: boolean
    name?: string
    nickname?: string
    picture?: string
    sub?: string
    [key: string]: string | boolean | undefined
}

interface Auth0ContextType {
    isAuthenticated: boolean
    isLoading: boolean
    isEnabled: boolean
    user: Auth0User | null
    loginWithRedirect: () => Promise<void>
    logout: () => void
}

const Auth0Context = createContext<Auth0ContextType | undefined>(undefined)

let auth0Client: Auth0Client | null = null

export function Auth0Provider({ children }: { children: React.ReactNode }) {
    const [isLoading, setIsLoading] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [user, setUser] = useState<Auth0User | null>(null)

    const isEnabled = !!(process.env.NEXT_PUBLIC_AUTH0_DOMAIN && process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID)


    useEffect(() => {
        const initAuth0 = async () => {
            if (!isEnabled) {
                setIsLoading(false)
                return
            }

            try {
                if (!auth0Client) {
                    auth0Client = await createAuth0Client({
                        domain: process.env.NEXT_PUBLIC_AUTH0_DOMAIN!,
                        clientId: process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID!,
                        authorizationParams: {
                            redirect_uri: process.env.NEXT_PUBLIC_AUTH0_REDIRECT_URI || window.location.origin,
                            scope: process.env.NEXT_PUBLIC_AUTH0_SCOPE || 'openid profile email',
                        },
                        cacheLocation: 'localstorage',
                    })
                }

                if (window.location.search.includes('code=') && window.location.search.includes('state=')) {
                    await auth0Client.handleRedirectCallback()
                    window.history.replaceState({}, document.title, window.location.pathname)
                }

                const authenticated = await auth0Client.isAuthenticated()
                setIsAuthenticated(authenticated)

                if (authenticated) {
                    const userProfile = await auth0Client.getUser()
                    setUser(userProfile || null)

                    if (userProfile?.sub) {
                        mixpanel.identify(userProfile.sub)
                        mixpanel.people.set({
                            $email: userProfile.email,
                            $name: userProfile.name,
                            email_verified: userProfile.email_verified,
                        })
                    }
                }
            } catch (error) {
                console.error('Auth0 initialization error:', error)
            } finally {
                setIsLoading(false)
            }
        }

        initAuth0()
    }, [isEnabled])

    const loginWithRedirect = useCallback(async () => {
        if (!auth0Client || !isEnabled) return
        await auth0Client.loginWithRedirect()
    }, [isEnabled])

    const logout = useCallback(() => {
        if (!auth0Client || !isEnabled) return

        const auth0Keys = Object.keys(localStorage).filter(key =>
            key.includes('auth0') || key.includes('@@auth0')
        )
        auth0Keys.forEach(key => localStorage.removeItem(key))

        auth0Client.logout({
            logoutParams: {
                returnTo: process.env.NEXT_PUBLIC_BASE_URL || window.location.origin,
            },
        })
    }, [isEnabled])

    return (
        <Auth0Context.Provider
            value={{
                isAuthenticated,
                isLoading,
                isEnabled,
                user,
                loginWithRedirect,
                logout,
            }}
        >
            {children}
        </Auth0Context.Provider>
    )
}

export function useAuth0() {
    const context = useContext(Auth0Context)
    if (!context) {
        throw new Error('useAuth0 must be used within an Auth0Provider')
    }
    return context
}

/**
 * Hook to require authentication for a component
 * Redirects to login if auth is enabled and user is not authenticated
 * Returns true when it's safe to render protected content
 */
export function useRequireAuth(): boolean {
    const { isAuthenticated, isLoading, isEnabled, loginWithRedirect } = useAuth0()

    useEffect(() => {
        if (isEnabled && !isLoading && !isAuthenticated) {
            loginWithRedirect()
        }
    }, [isEnabled, isLoading, isAuthenticated, loginWithRedirect])

    if (!isEnabled) return true
    if (isLoading) return false
    return isAuthenticated
}

/**
 * HOC to protect components/pages
 * Usage: export default withAuth(YourComponent)
 */
export function withAuth<P extends object>(
    Component: React.ComponentType<P>,
    options?: {
        redirectTo?: string
        fallback?: React.ReactNode
    }
) {
    return function ProtectedComponent(props: P) {
        const { isAuthenticated, isLoading, isEnabled, loginWithRedirect } = useAuth0()

        useEffect(() => {
            if (isEnabled && !isLoading && !isAuthenticated) {
                loginWithRedirect()
            }
        }, [isEnabled, isLoading, isAuthenticated, loginWithRedirect])

        if (!isEnabled) {
            return <Component {...props} />
        }

        if (isLoading) {
            return (
                options?.fallback || (
                    <div className="flex items-center justify-center min-h-screen">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary" />
                    </div>
                )
            )
        }

        if (!isAuthenticated) {
            return null
        }

        return <Component {...props} />
    }
}