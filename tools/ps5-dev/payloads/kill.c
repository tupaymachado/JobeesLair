// Closes Jobee'sLair (PPSA99471) on the owner's PS5, for a remount test; prints what the system answered.
#include <stdio.h>
#include <unistd.h>
int sceUserServiceInitialize(void*);
int sceLncUtilGetAppId(const char* title_id);
int sceLncUtilKillApp(int app_id);
int main(void) {
  sceUserServiceInitialize(0);
  int id = sceLncUtilGetAppId("PPSA99471");
  printf("app id 0x%x\n", id);
  if (id > 0) printf("kill 0x%x\n", sceLncUtilKillApp(id));
  for (int i = 0; i < 20; i++) { usleep(250000); if (sceLncUtilGetAppId("PPSA99471") <= 0) { printf("closed\n"); return 0; } }
  printf("still open\n");
  return 0;
}
