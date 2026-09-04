import type { RouteComponent, RouteRecordRaw } from 'vue-router'

export type ResourceOverviewLoader = () => Promise<RouteComponent>

const loadResourceOverview: ResourceOverviewLoader = async () => (await import('@/views/ResourceOverview.vue')).default

export function createRoutes(resourceOverviewLoader: ResourceOverviewLoader = loadResourceOverview): RouteRecordRaw[] {
  return [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/instance/:id',
      name: 'instance-detail',
      component: () => import('@/views/InstanceDetail.vue'),
    },
    {
      path: '/resources',
      name: 'resources',
      component: resourceOverviewLoader,
    },
  ]
}

export const routes = createRoutes()
