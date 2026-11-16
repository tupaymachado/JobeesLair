// Brings Jobee'sLair (PPSA99471) to the front on the owner's PS5 (launching a running app resumes it).
#include <stdio.h>
#include <stdint.h>
typedef struct { uint32_t size, user_id, app_opt; uint64_t crash_report; uint32_t check_flag; } LncAppParam;
int sceUserServiceInitialize(void*);
int sceUserServiceGetForegroundUser(int*);
int sceLncUtilLaunchApp(const char* title_id, const char** argv, LncAppParam* param);
int main(void) {
  sceUserServiceInitialize(0);
  LncAppParam param = {sizeof param, 0, 0, 0, 0};
  sceUserServiceGetForegroundUser((int*)&param.user_id);
  printf("launch 0x%x\n", sceLncUtilLaunchApp("PPSA99471", 0, &param));
  return 0;
}
