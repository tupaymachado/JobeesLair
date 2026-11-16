// Prints whether Jobee'sLair and YouTube are running on the owner's PS5 (read only).
#include <stdio.h>
int sceUserServiceInitialize(void*);
int sceLncUtilGetAppId(const char* title_id);
int main(void) {
  sceUserServiceInitialize(0);
  printf("PPSA99471 0x%x\nPPSA01650 0x%x\n", sceLncUtilGetAppId("PPSA99471"), sceLncUtilGetAppId("PPSA01650"));
  return 0;
}
