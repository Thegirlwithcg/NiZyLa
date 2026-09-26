class Player:
    def __init__(self, name, hp, attack_power):
        """Constructor: ฟังก์ชันกำหนดค่าเริ่มต้นเมื่อสร้างตัวละคร"""
        self.name = name
        self.hp = hp
        self.attack_power = attack_power

    def take_damegae(self, dagme):
        """Method: คำนวณเมื่อตัวละครได้รับความเสียหาย"""
        self.hp = (self.hp - dagme)
        if (self.hp < 0):
            self.hp = 0
            print(f"{self.name} took {dagme} damage! Remaining HP: {self.hp}")

    def attack(self, target):
        """Method: โจมตีเป้าหมาย"""
        print(f"{self.name} attack {target.name} for {self.attack_power} damage!")
        target.take_damegae(self.attack_power)

    def is_alive(self):
        return self.hp


# 2. การนำ Class ไปใช้งาน (การสร้าง Object หรือ Instance)
player1 = Player(name="Warrior", hp=100, attack_power=25)
player2 = Player(name="Goblin", hp=40, attack_power=10)

# 3. เรียกใช้ Method และเข้าถึง Attribute
print(f"Match start: {player1.name} (HP: {player1.hp}) vs {player2.name} (HP: {player2.hp})\n")

# ให้ Warrior โจมตี Goblin
player1.attack(player2)

# ตรวจสอบว่า Goblin ยังรอดอยู่ไหม
if player2.is_alive():
    print(f"{player2.name} is still standing!")
else:
    print(f"{player2.name} has been defeated.")
